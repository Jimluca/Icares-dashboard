// IPI-mails versturen (SMTP) en de mailbox invoices@ opruimen (IMAP), zoals Robert deed.
import fs from 'node:fs'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import nodemailer, { type Transporter } from 'nodemailer'
import { MAX_INVOICES_PER_MAIL, type IpiInvoiceFile } from '../../shared/ipi'

export const SMTP_HOST = 'smtp-auth.mailprotect.be'
export const IMAP_HOST = 'imap.mailprotect.be'
export const SUBJECT = 'Facturering IPI'
const FROM = 'Icares support <support@icares.nl>'

export interface MailLogin {
  user: string
  pass: string
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface IpiMailJob {
  templatesDir: string // map met Roberts html-sjablonen (IPI-Development)
  smtp: MailLogin
  orgName: string
  billingEmail: string
  salutation: string
  invoices: (IpiInvoiceFile & { firstname: string; middlename: string; lastname: string })[]
  infoRecipients: string[]
  infoSalutation: string
  /** Testmodus: ALLE mails gaan alleen naar dit adres. */
  testAddress?: string
  /** Alleen voor tests: een eigen transport in plaats van de echte mailserver. */
  transport?: Transporter
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function sendIpiMails(job: IpiMailJob, log: (s: string) => void): Promise<void> {
  const transport = job.transport ?? nodemailer.createTransport({ host: SMTP_HOST, port: 465, secure: true, auth: { user: job.smtp.user, pass: job.smtp.pass } })
  if (!job.transport) {
    await transport.verify().catch((e: Error) => {
      throw new Error(`Inloggen op de mailserver mislukt (${e.message}). Controleer het wachtwoord van ${job.smtp.user} in de kluis.`)
    })
  }
  const read = (f: string): string => fs.readFileSync(path.join(job.templatesDir, f), 'utf8')
  const clientBody = read('invoice_ipi_template.html').replace(/<!-- ContactPersoon -->/g, esc(job.salutation))
  const test = job.testAddress
  const pre = test ? '[TEST] ' : ''

  let i = 1
  for (const part of chunks(job.invoices, MAX_INVOICES_PER_MAIL)) {
    const attachments = part.map((inv) => ({ filename: path.basename(inv.pdf), path: inv.pdf }))
    const rows = part
      .map((inv) => `<tr>\n<td>${esc(inv.nr)}</td>\n<td>${inv.userId}</td>\n<td>${esc(inv.firstname)}</td>\n<td>${esc(inv.middlename)}</td>\n<td>${esc(inv.lastname)}</td>\n</tr>\n`)
      .join('')
    const infoBody = read('ter_info_invoice_ipi_template.html')
      .replace(/<!-- ContactPersoon -->/g, esc(job.infoSalutation))
      .replace(/<!-- IPI_ContactPersoon -->/g, esc(job.salutation))
      .replace(/<!-- IPI_Email -->/g, esc(job.billingEmail))
      .replace(/<!-- IPI_Invoice_Table -->/g, rows)

    // 1. naar de klant  2. kopie naar invoices@  3. ter info naar facturen@ (+ Highrise)
    const mails = [
      { to: test ?? job.billingEmail, subject: `${pre}${SUBJECT}`, html: clientBody, what: `factuur naar ${job.billingEmail}` },
      { to: test ?? 'invoices@icares.nl', subject: `${pre}${SUBJECT}`, html: clientBody, what: 'kopie naar invoices@icares.nl' },
      { to: test ?? job.infoRecipients.join(', '), subject: `${pre}Ter info: ${SUBJECT} voor organisatie ${job.orgName}`, html: infoBody, what: `ter info naar ${job.infoRecipients.join(', ')}` }
    ]
    for (const m of mails) {
      await transport.sendMail({ from: FROM, replyTo: FROM, to: m.to, subject: m.subject, html: m.html, attachments })
      log(`Mail ${i}: ${m.what}${test ? ` (testmodus: verstuurd naar ${test})` : ''}`)
    }
    i++
  }
  transport.close()
}

/** Verplaatst mails "Facturering IPI" in invoices@ van INBOX naar IPI_verzonden_facturen. */
export async function moveSentCopies(imap: MailLogin, log: (s: string) => void): Promise<void> {
  const client = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: imap, logger: false })
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = (await client.search({ subject: SUBJECT }, { uid: true })) || []
      if (uids.length) await client.messageMove(uids, 'IPI_verzonden_facturen', { uid: true })
      log(`Mailbox invoices@: ${uids.length} eerdere kopie(ën) verplaatst naar IPI_verzonden_facturen.`)
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
}
