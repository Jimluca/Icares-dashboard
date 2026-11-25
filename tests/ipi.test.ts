// Tests voor de IPI-facturatie. Er wordt niets echt gemaild en geen echte database gebruikt.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import nodemailer, { type SendMailOptions } from 'nodemailer'
import { describe, expect, it } from 'vitest'
import { amounts, clientLabel, displayInvoiceNr, invoiceBaseName, notesSuffix, padNr, salutationOptions, type IpiOrg } from '../src/shared/ipi'
import { assignNumbers } from '../src/main/ipi/db'
import { invoiceHtml, writeInvoiceXlsx } from '../src/main/ipi/invoice'
import { sendIpiMails, type IpiMailJob } from '../src/main/ipi/mail'
import { appendOverview, isOpenInExcel, OVERVIEW_COLUMNS } from '../src/main/ipi/overview'

const SCRIPTS = path.join(os.homedir(), 'Icares B.V', 'MT - Documents', 'Scripts', 'IPI-Development')
const haveScripts = fs.existsSync(SCRIPTS)
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ipi-test-'))
const DATE = new Date(2026, 10, 23)

const org: IpiOrg = {
  orgId: 279, name: 'Hehamahua', invoiceName: 'Hehamahua', billingEmail: 'klant@example.com', contactPerson: 'Anna de Vries',
  salutations: salutationOptions('Anna de Vries'), addressLine: 'Straat 1', postalCityLine: '1234AB Plaats', debNr: '515', priceExcl: 68,
  clients: [{ userId: 280105, firstname: 'Moreno', middlename: '', lastname: 'Span', email: 'm@example.com' }], problems: []
}

describe('rekenregels (gelijk aan Roberts script)', () => {
  it('factuurnummers en bestandsnamen', () => {
    expect(padNr(574)).toBe('0574')
    expect(displayInvoiceNr(574, DATE)).toBe('IPI0574-23/11/2026')
    expect(invoiceBaseName(574, 'Hehamahua', DATE)).toBe('IPI0574Hehamahua23112026')
    expect(invoiceBaseName(9, 'A/B: C', DATE)).toBe('IPI0009AB C23112026')
  })
  it('bedragen incl. 21% btw', () => {
    expect(amounts(68)).toEqual({ excl: 68, btw: 14.28, total: 82.28 })
    expect(amounts(59.5).total).toBe(72)
  })
  it('initialen en aanhef', () => {
    expect(clientLabel({ firstname: 'Moreno', lastname: 'Span', userId: 280105 })).toBe('M.S. (user-id: 280105)')
    expect(salutationOptions('Anna de Vries')).toEqual(['Anna', 'Anna de', 'Anna de Vries'])
    expect(salutationOptions('')).toEqual([])
  })
  it('notitieveld zoals Robert', () => {
    expect(notesSuffix(575, DATE)).toBe('\n<IPIFacNr>0575</IPIFacNr>\n<IPIFacDate>2026-11-23</IPIFacDate>\n<IPIFacStatus>OPEN</IPIFacStatus>')
  })
  it('factuur-HTML bevat de juiste gegevens en ontsnapt HTML', () => {
    const html = invoiceHtml({ org: { ...org, invoiceName: 'A&B <bv>' }, client: org.clients[0], nr: 574, date: DATE, test: false }, 'data:,')
    expect(html).toContain('IPI0574-23/11/2026')
    expect(html).toContain('82,28')
    expect(html).toContain('A&amp;B &lt;bv&gt;')
    expect(html).not.toContain('TESTFACTUUR')
    expect(invoiceHtml({ org, client: org.clients[0], nr: 574, date: DATE, test: true }, 'data:,')).toContain('TESTFACTUUR')
  })
})

describe.skipIf(!haveScripts)('Excel-bestanden', () => {
  it('vult Roberts Excel-sjabloon', async () => {
    const f = path.join(tmp(), 'f.xlsx')
    await writeInvoiceXlsx(path.join(SCRIPTS, 'ipi_templates', 'ipi_factuur_sjabloon.xlsx'), f, { org, client: org.clients[0], nr: 575, date: DATE, test: false })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(f)
    const ws = wb.worksheets[0]
    expect(ws.getCell('A1').value).toBe('Hehamahua')
    expect(ws.getCell('B10').value).toBe('D515')
    expect(ws.getCell('B11').value).toBe('IPI0575-23/11/2026')
    expect(ws.getCell('A19').value).toBe('Cliënt initialen: M.S. (user-id: 280105)')
    expect(ws.getCell('D22').value).toBe(68)
  })

  it('voegt regels toe aan het overzicht en respecteert een geopend bestand', async () => {
    const dir = tmp()
    const f = path.join(dir, '__openstaande_IPI_facturen.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Table1')
    ws.addRow([...OVERVIEW_COLUMNS, 'Herinnering'])
    ws.addRow([574, 82.28, 280105, new Date(Date.UTC(2026, 10, 23)), 'Still time to pay', 'OPEN', 'M', 'S', 'm@x.nl', 279, 'Hehamahua'])
    await wb.xlsx.writeFile(f)
    await appendOverview(f, [[575, 82.28, 1, new Date(Date.UTC(2026, 10, 24)), 'Still time to pay', 'OPEN', 'A', 'B', 'a@x.nl', 279, 'Hehamahua']])
    const back = new ExcelJS.Workbook()
    await back.xlsx.readFile(f)
    expect(back.worksheets[0].getRow(3).getCell(1).value).toBe(575)
    expect(back.worksheets[0].getRow(2).getCell(1).value).toBe(574)
    fs.writeFileSync(path.join(dir, '~$__openstaande_IPI_facturen.xlsx'), '')
    expect(isOpenInExcel(f)).toBe(true)
    await expect(appendOverview(f, [])).rejects.toThrow(/geopend in Excel/)
  })
})

describe.skipIf(!haveScripts)('mails', () => {
  const job = (over: Partial<IpiMailJob>): IpiMailJob & { sent: { to: string; subject: string; files: string[] }[] } => {
    const sent: { to: string; subject: string; files: string[] }[] = []
    const t = nodemailer.createTransport({ jsonTransport: true })
    const orig = t.sendMail.bind(t)
    t.sendMail = ((m: SendMailOptions) => {
      sent.push({ to: String(m.to), subject: String(m.subject), files: (m.attachments ?? []).map((a: { filename?: unknown }) => String(a.filename)) })
      return orig(m)
    }) as typeof t.sendMail
    const dir = tmp()
    const invoices = Array.from({ length: 7 }, (_, i) => {
      const pdf = path.join(dir, `IPI${575 + i}.pdf`)
      fs.writeFileSync(pdf, '%PDF-test')
      return { nr: padNr(575 + i), userId: i, pdf, xlsx: '', firstname: 'A', middlename: '', lastname: 'B' }
    })
    return {
      templatesDir: SCRIPTS, smtp: { user: 'u', pass: 'p' }, orgName: 'Org', billingEmail: 'klant@example.com', salutation: 'Anna',
      invoices, infoRecipients: ['facturen@icares.nl', 'dropbox@36404337.icares.highrisehq.com'], infoSalutation: 'Karin en Mila', transport: t, sent, ...over
    }
  }

  it('echte run: klant, kopie invoices@, ter info; per 5 facturen; geen Gmail van Robert', async () => {
    const j = job({})
    await sendIpiMails(j, () => {})
    expect(j.sent).toHaveLength(6) // 2 batches (5 + 2) x 3 mails
    expect(j.sent.map((m) => m.to)).toEqual([
      'klant@example.com', 'invoices@icares.nl', 'facturen@icares.nl, dropbox@36404337.icares.highrisehq.com',
      'klant@example.com', 'invoices@icares.nl', 'facturen@icares.nl, dropbox@36404337.icares.highrisehq.com'
    ])
    expect(j.sent[0].files).toHaveLength(5)
    expect(j.sent[3].files).toHaveLength(2)
    expect(JSON.stringify(j.sent)).not.toMatch(/gmail|rojanssen/i)
  })

  it('testmodus: ALLE mails alleen naar het testadres', async () => {
    const j = job({ testAddress: 'tester@icares.com' })
    await sendIpiMails(j, () => {})
    expect(j.sent.every((m) => m.to === 'tester@icares.com')).toBe(true)
    expect(j.sent.every((m) => m.subject.startsWith('[TEST]'))).toBe(true)
  })
})

describe('nummeren (alles-of-niets)', () => {
  // Nagebootste databaseverbinding
  function fakeConn(opts: { max: number; clients: number[]; failUpdateFor?: number }) {
    const calls: string[] = []
    const conn = {
      calls,
      async query(sql: string | { sql: string }, params?: unknown[]) {
        const q = typeof sql === 'string' ? sql : sql.sql
        if (/GET_LOCK/.test(q)) return [[{ ok: 1 }]]
        if (/RELEASE_LOCK/.test(q)) return [[{}]]
        if (/having IPIFacNr = 0/.test(q)) return [opts.clients.map((id) => ({ id, firstname: 'A', middlename: '', lastname: 'B', email: '', org_id: 279 }))]
        if (/from organizations o\s+left join addresses/.test(q)) return [[{ id: 279, name: 'Org', billing_email: 'a@b.nl', billing_contact_person: 'A', street: 's', street_nr: '1', street_nr_additional: '', postal_code: 'p', city: 'c', DebNr: 1, IPIPrice: 68 }]]
        if (/order by IPIFacNr desc limit 1/.test(q)) return [[{ IPIFacNr: opts.max }]]
        if (/^UPDATE users/.test(q.trim())) {
          calls.push(`update ${(params as unknown[])[1]}`)
          return [{ affectedRows: (params as unknown[])[1] === opts.failUpdateFor ? 0 : 1 }]
        }
        throw new Error(`onverwachte query: ${q.slice(0, 40)}`)
      },
      async beginTransaction() { calls.push('begin') },
      async commit() { calls.push('commit') },
      async rollback() { calls.push('rollback') }
    }
    return conn
  }

  it('geeft opeenvolgende nummers vanaf max+1 en legt pas daarna vast', async () => {
    const c = fakeConn({ max: 574, clients: [11, 10] })
    let undone = false
    const nums = await assignNumbers(c as never, 279, [10, 11], DATE, async (n) => [...n.entries()], () => (undone = true))
    expect(nums).toEqual([[10, 575], [11, 576]])
    expect(c.calls).toEqual(['begin', 'update 10', 'update 11', 'commit'])
    expect(undone).toBe(false)
  })

  it('stopt als de lijst intussen veranderd is (niets vastgelegd)', async () => {
    const c = fakeConn({ max: 574, clients: [10, 11, 12] })
    await expect(assignNumbers(c as never, 279, [10, 11], DATE, async () => 1, () => {})).rejects.toThrow(/veranderd/)
    expect(c.calls).toEqual([])
  })

  it('maakt alles ongedaan als bestanden maken mislukt', async () => {
    const c = fakeConn({ max: 574, clients: [10] })
    let undone = false
    await expect(assignNumbers(c as never, 279, [10], DATE, async () => { throw new Error('pdf kapot') }, () => (undone = true))).rejects.toThrow('pdf kapot')
    expect(undone).toBe(true)
    expect(c.calls).toEqual([])
  })

  it('rolt terug als één cliënt al een nummer blijkt te hebben', async () => {
    const c = fakeConn({ max: 574, clients: [10, 11], failUpdateFor: 11 })
    let undone = false
    await expect(assignNumbers(c as never, 279, [10, 11], DATE, async () => 1, () => (undone = true))).rejects.toThrow(/11/)
    expect(c.calls).toEqual(['begin', 'update 10', 'update 11', 'rollback'])
    expect(undone).toBe(true)
  })
})

describe('betaald zetten', async () => {
  const { markPaid, removeFromOverview } = await import('../src/main/ipi/paid')
  function conn(affected: number) {
    const calls: string[] = []
    return {
      calls,
      async query(sql: string, params: unknown[]) {
        calls.push(`${sql.includes('PAYED') ? 'update' : '?'} ${JSON.stringify(params)}`)
        return [{ affectedRows: affected }]
      },
      async beginTransaction() { calls.push('begin') },
      async commit() { calls.push('commit') },
      async rollback() { calls.push('rollback') }
    }
  }
  it('zet precies de gekozen facturen op PAYED', async () => {
    const c = conn(2)
    await markPaid(c as never, [10, 11])
    expect(c.calls).toEqual(['begin', 'update [[10,11]]', 'commit'])
  })
  it('rolt terug als het aantal niet klopt', async () => {
    const c = conn(1)
    await expect(markPaid(c as never, [10, 11])).rejects.toThrow(/niets gewijzigd/)
    expect(c.calls.at(-1)).toBe('rollback')
  })
  it('weigert een lege selectie', async () => {
    await expect(markPaid(conn(0) as never, [])).rejects.toThrow()
  })
  it('haalt alleen de betaalde regels uit het overzicht', async () => {
    const f = path.join(tmp(), '__openstaande_IPI_facturen.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Table1')
    ws.addRow([...OVERVIEW_COLUMNS, 'Herinnering'])
    ws.addRow([574, 82.28, 100, new Date(), 'x', 'OPEN', 'A', 'B', 'a@x', 1, 'Org'])
    ws.addRow([575, 82.28, 101, new Date(), 'x', 'OPEN', 'C', 'D', 'c@x', 1, 'Org'])
    ws.addRow([576, 82.28, 102, new Date(), 'x', 'OPEN', 'E', 'F', 'e@x', 1, 'Org'])
    await wb.xlsx.writeFile(f)
    expect(await removeFromOverview(f, [{ nr: '0575', userId: 101 }, { nr: '0999', userId: 5 }])).toBe(1)
    const back = new ExcelJS.Workbook()
    await back.xlsx.readFile(f)
    const nrs: unknown[] = []
    back.worksheets[0].eachRow((r, i) => i > 1 && nrs.push(r.getCell(1).value))
    expect(nrs).toEqual([574, 576])
  })
})
