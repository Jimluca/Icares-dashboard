// IPI-facturatie: de volledige werkwijze van Roberts 01_ipi_make_invoices.pl, in het dashboard.
//
// Echt versturen:
//   1. (optioneel) vorige kopieën in invoices@ verplaatsen
//   2. onder een databaseslot: nummers bepalen -> pdf + Excel maken in SharePoint
//      -> pas als dat lukt de nummers in de database vastleggen (alles-of-niets)
//   3. mails versturen (per 5 facturen): klant, kopie invoices@, ter info facturen@ + Highrise
//   4. (optioneel) regels toevoegen aan __openstaande_IPI_facturen.xlsx
// Testmodus: geen databasewijziging, bestanden in een lokale testmap, ALLE mails naar het testadres.
import crypto from 'node:crypto'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  amounts,
  DEFAULT_IPI_CONFIG,
  invoiceBaseName,
  isEmail,
  padNr,
  type IpiConfig,
  type IpiInvoiceFile,
  type IpiOrg,
  type IpiPreview,
  type IpiSendOptions,
  type IpiSendResult
} from '../../shared/ipi'
import { localDataDir } from '../paths'
import { loadSettings } from '../settings'
import type { VaultSession } from '../vault/vault'
import { ensureOpen, dbLogin, tunnel } from '../db/service'
import { assignNumbers, connect, loadNewClients, maxInvoiceNr } from './db'
import { invoiceHtml, writeInvoiceXlsx, type InvoiceData } from './invoice'
import { moveSentCopies, sendIpiMails, type IpiMailJob, type MailLogin } from './mail'
import { appendOverview, OVERVIEW_COLUMNS, OVERVIEW_FILE, type OverviewRow } from './overview'
import { listOpen, markPaid as dbMarkPaid, removeFromOverview } from './paid'
import type { MarkPaidResult, OpenInvoice } from '../../shared/ipi'
import { htmlToPdf, letterhead } from './pdf'
import { scriptDir } from '../bundled'

const SMTP_TITLE = 'support@icares.nl webmail'
const IMAP_TITLE = 'Icares invoices mail'

export function ipiConfig(s: VaultSession): IpiConfig {
  return { ...DEFAULT_IPI_CONFIG, ...(s.getConfig().ipi ?? {}) }
}

function mailLogin(s: VaultSession, id: string | undefined, title: string, what: string): MailLogin {
  const e = s.findConfigured(id, title)
  if (!e?.username || !e.password) throw new Error(`Geen toegang tot het kluisitem voor ${what} ("${title}"), of gebruikersnaam/wachtwoord ontbreekt.`)
  return { user: e.username, pass: e.password }
}

function ipiDir(): string {
  return scriptDir('IPI-Development', path.join('ipi_templates', 'ipi_factuur_sjabloon.xlsx'))
}

export function invoiceFolder(date = new Date()): string {
  const mt = path.dirname(loadSettings().scriptsRoot) // ...\MT - Documents
  return path.join(mt, '02 Management', '02 Financien - facturen - kasboek - RVK', '01 facturen en herinneringen', 'Icares BV', '01 Facturen', `facturen ${date.getFullYear()} IPI`)
}

export async function preview(s: VaultSession): Promise<IpiPreview> {
  await ensureOpen(s)
  const conn = await connect(tunnel, dbLogin(s))
  try {
    const orgs = await loadNewClients(conn)
    const folder = invoiceFolder()
    return { orgs, nextInvoiceNr: (await maxInvoiceNr(conn)) + 1, invoiceFolder: folder, invoiceFolderExists: fs.existsSync(path.dirname(folder)) }
  } finally {
    await conn.end().catch(() => conn.destroy())
  }
}

async function makeFiles(org: IpiOrg, numbers: Map<number, number>, date: Date, outDir: string, test: boolean, created: string[]): Promise<IpiInvoiceFile[]> {
  const template = path.join(ipiDir(), 'ipi_templates', 'ipi_factuur_sjabloon.xlsx')
  if (!fs.existsSync(template)) throw new Error(`Excel-sjabloon niet gevonden: ${template}`)
  fs.mkdirSync(outDir, { recursive: true })
  const out: IpiInvoiceFile[] = []
  for (const client of org.clients) {
    const nr = numbers.get(client.userId)!
    const base = path.join(outDir, (test ? 'TEST_' : '') + invoiceBaseName(nr, org.invoiceName, date))
    if (fs.existsSync(`${base}.pdf`)) throw new Error(`Er bestaat al een bestand ${path.basename(base)}.pdf. Uit voorzorg is er niets gedaan.`)
    const data: InvoiceData = { org, client, nr, date, test }
    await htmlToPdf(invoiceHtml(data, letterhead()), `${base}.pdf`)
    created.push(`${base}.pdf`)
    await writeInvoiceXlsx(template, `${base}.xlsx`, data)
    created.push(`${base}.xlsx`)
    out.push({ nr: padNr(nr), userId: client.userId, pdf: `${base}.pdf`, xlsx: `${base}.xlsx` })
  }
  return out
}

/** Maakt één voorbeeldfactuur (testopmaak) en geeft het pad terug. Wijzigt niets. */
export async function samplePdf(s: VaultSession, orgId: number): Promise<string> {
  const p = await preview(s)
  const org = p.orgs.find((o) => o.orgId === orgId)
  if (!org) throw new Error('Organisatie niet (meer) gevonden.')
  const client = org.clients[0]
  const dir = path.join(localDataDir(), 'ipi-voorbeeld')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `Voorbeeld_${invoiceBaseName(p.nextInvoiceNr, org.invoiceName, new Date())}.pdf`)
  await htmlToPdf(invoiceHtml({ org, client, nr: p.nextInvoiceNr, date: new Date(), test: true }, letterhead()), file)
  return file
}

interface Run {
  job: IpiMailJob
}
const runs = new Map<string, Run>()

export async function send(s: VaultSession, opts: IpiSendOptions, log: (line: string) => void): Promise<IpiSendResult> {
  const cfg = ipiConfig(s)
  const test = opts.test
  if (test && !isEmail(opts.testAddress)) throw new Error('Vul een geldig testadres in.')
  if (!test && !isEmail(opts.billingEmail)) throw new Error('Het factuur-e-mailadres is ongeldig.')
  if (!opts.salutation.trim()) throw new Error('Kies een aanhef.')
  const smtp = mailLogin(s, cfg.smtpEntryId, SMTP_TITLE, 'het versturen van mail')

  const p = await preview(s)
  const org = p.orgs.find((o) => o.orgId === opts.orgId)
  if (!org) throw new Error('Deze organisatie heeft geen nieuwe IPI-cliënten (meer). Klik op "Vernieuwen".')
  if (org.problems.length && !test) throw new Error(org.problems.join(' '))
  const lines: string[] = []
  const say = (l: string): void => {
    lines.push(l)
    log(l)
  }
  const warnings: string[] = []
  const date = new Date()

  if (!test && cfg.moveImapMails) {
    try {
      await moveSentCopies(mailLogin(s, cfg.imapEntryId, IMAP_TITLE, 'de mailbox invoices@'), say)
    } catch (e) {
      warnings.push(`Mailbox invoices@ niet opgeruimd: ${(e as Error).message}`)
    }
  }

  let invoices: IpiInvoiceFile[]
  const created: string[] = []
  if (test) {
    const numbers = new Map(org.clients.map((c, i) => [c.userId, p.nextInvoiceNr + i]))
    const dir = path.join(localDataDir(), 'ipi-test', new Date().toISOString().replace(/[:.]/g, '-'))
    invoices = await makeFiles(org, numbers, date, dir, true, created)
    say(`Testmodus: ${invoices.length} testfactuur/facturen gemaakt in ${dir}. Database NIET gewijzigd.`)
  } else {
    let folder = invoiceFolder(date)
    if (!fs.existsSync(path.dirname(folder))) {
      // Geen SharePoint op deze pc: lokaal opslaan en melden dat ze nog naar SharePoint moeten
      folder = path.join(app.getPath('documents'), `IPI-facturen ${date.getFullYear()}`)
      warnings.push(`De SharePoint-map met facturen staat niet op deze pc. De facturen zijn opgeslagen in ${folder}; zet ze later in SharePoint (facturen ${date.getFullYear()} IPI) en werk __openstaande_IPI_facturen.xlsx bij.`)
    }
    await ensureOpen(s)
    const conn = await connect(tunnel, dbLogin(s))
    try {
      invoices = await assignNumbers(
        conn,
        org.orgId,
        opts.userIds,
        date,
        (numbers) => makeFiles(org, numbers, date, folder, false, created),
        () => created.forEach((f) => fs.rmSync(f, { force: true }))
      )
    } finally {
      await conn.end().catch(() => conn.destroy())
    }
    say(`Factuurnummers vastgelegd in de database: ${invoices.map((i) => `IPI${i.nr}`).join(', ')}.`)
    say(`Opgeslagen in ${folder}.`)
  }

  const job: IpiMailJob = {
    templatesDir: ipiDir(),
    smtp,
    orgName: org.invoiceName,
    billingEmail: opts.billingEmail.trim(),
    salutation: opts.salutation.trim(),
    invoices: invoices.map((inv) => {
      const c = org.clients.find((x) => x.userId === inv.userId)!
      return { ...inv, firstname: c.firstname, middlename: c.middlename, lastname: c.lastname }
    }),
    infoRecipients: cfg.infoRecipients,
    infoSalutation: cfg.infoSalutation,
    testAddress: test ? opts.testAddress.trim() : undefined
  }
  const runId = crypto.randomUUID()
  runs.set(runId, { job })
  let mailed = false
  try {
    await sendIpiMails(job, say)
    mailed = true
  } catch (e) {
    warnings.push(`Mailen mislukt: ${(e as Error).message} De facturen zijn wel gemaakt${test ? '' : ' en genummerd'}; gebruik "Opnieuw mailen".`)
  }

  const a = amounts(org.priceExcl)
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const rows: OverviewRow[] = invoices.map((inv) => {
    const c = org.clients.find((x) => x.userId === inv.userId)!
    return [Number(inv.nr), a.total, inv.userId, day, 'Still time to pay', 'OPEN', c.firstname, c.lastname, c.email, org.orgId, org.name]
  })
  if (!test && cfg.appendOverview) {
    try {
      await appendOverview(path.join(invoiceFolder(date), OVERVIEW_FILE), rows)
      say(`${rows.length} regel(s) toegevoegd aan ${OVERVIEW_FILE}.`)
    } catch (e) {
      warnings.push(`Overzicht niet bijgewerkt: ${(e as Error).message}`)
    }
  }

  return {
    runId,
    test,
    orgName: org.invoiceName,
    invoices,
    mailed,
    log: lines,
    warnings,
    overviewRows: { columns: OVERVIEW_COLUMNS, rows: rows.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v))) }
  }
}

export async function resend(runId: string, log: (l: string) => void): Promise<void> {
  const run = runs.get(runId)
  if (!run) throw new Error('Deze verzending is niet meer bekend (dashboard herstart?). Mail de pdf\'s handmatig vanuit de SharePoint-map.')
  await sendIpiMails(run.job, log)
}

// ---------- betaalde facturen ----------
export async function openInvoices(s: VaultSession): Promise<OpenInvoice[]> {
  await ensureOpen(s)
  const conn = await connect(tunnel, dbLogin(s))
  try {
    return await listOpen(conn)
  } finally {
    await conn.end().catch(() => conn.destroy())
  }
}

export async function markPaid(s: VaultSession, userIds: number[]): Promise<MarkPaidResult> {
  await ensureOpen(s)
  const conn = await connect(tunnel, dbLogin(s))
  let selected: OpenInvoice[]
  try {
    const open = await listOpen(conn)
    selected = open.filter((o) => userIds.includes(o.userId))
    if (selected.length !== userIds.length) throw new Error('Een of meer facturen staan niet (meer) open. Klik op "Vernieuwen".')
    await dbMarkPaid(conn, userIds)
  } finally {
    await conn.end().catch(() => conn.destroy())
  }
  const warnings: string[] = []
  let overviewRemoved = 0
  if (ipiConfig(s).appendOverview) {
    // Het overzicht staat in de map van het jaar van de factuur
    const byYear = new Map<number, OpenInvoice[]>()
    for (const inv of selected) {
      const y = Number(inv.date.slice(0, 4)) || new Date().getFullYear()
      byYear.set(y, [...(byYear.get(y) ?? []), inv])
    }
    for (const [year, list] of byYear) {
      const file = path.join(invoiceFolder(new Date(year, 0, 1)), OVERVIEW_FILE)
      try {
        overviewRemoved += await removeFromOverview(file, list)
      } catch (e) {
        warnings.push(`Overzicht ${year} niet bijgewerkt: ${(e as Error).message}`)
      }
    }
    if (overviewRemoved < selected.length && warnings.length === 0) {
      warnings.push(`${selected.length - overviewRemoved} factuur/facturen stonden niet in ${OVERVIEW_FILE}; daar hoefde niets weg.`)
    }
  }
  return { updated: selected.length, overviewRemoved, warnings }
}
