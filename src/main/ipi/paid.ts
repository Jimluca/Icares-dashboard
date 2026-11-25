// Betaalde IPI-facturen: openstaande facturen tonen en op PAYED zetten
// (stap E uit Roberts handleiding "IPI facturen maken en betalingen administreren").
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type mysql from 'mysql2/promise'
import type { OpenInvoice } from '../../shared/ipi'
import { localDataDir } from '../paths'
import { isOpenInExcel, OVERVIEW_COLUMNS, OVERVIEW_FILE } from './overview'

const N = (tag: string, col: string): string =>
  `substr(${col}, (instr(${col},'<${tag}>') + ${tag.length + 2}), instr(${col},'</${tag}>') - ${tag.length + 2} - instr(${col},'<${tag}>'))`

/** Zelfde selectie als Roberts get_ipi_clients_invoice_date.sql / get_open_ipi_invoices_per_organization. */
const OPEN_SQL = `
select ${N('IPIFacNr', 'u.notes')} as IPIFacNr,
       convert(${N('IPIPrice', 'o.notes')}, DECIMAL(10,2)) as IPIPrice,
       u.id as user_id,
       convert(${N('IPIFacDate', 'u.notes')}, DATE) as IPIFacDate,
       IF(NOW() > date_add(${N('IPIFacDate', 'u.notes')}, INTERVAL 8 DAY), 1, 0) as expired,
       ${N('IPIFacStatus', 'u.notes')} as IPIFacStatus,
       u.firstname, u.middlename, u.lastname, u.email, o.id as org_id, o.name as org_name
from users u join organizations o on o.id = u.organization_id
where u.organization_id in (
    select id from (select id, ${N('IPIPrice', 'notes')} as IPIPrice from organizations o group by id having IPIPrice != '') as xxx)
  and u.role = 'client'
  and u.created_at > o.license_start_date
group by u.id
having IPIFacDate != 0 and IPIFacStatus = 'OPEN'
order by o.name, IPIFacNr`

export async function listOpen(conn: mysql.Connection): Promise<OpenInvoice[]> {
  const [rows] = await conn.query(OPEN_SQL)
  return (rows as Record<string, unknown>[]).map((r) => ({
    nr: String(r.IPIFacNr ?? '').trim(),
    userId: Number(r.user_id),
    date: String(r.IPIFacDate ?? ''),
    expired: Number(r.expired) === 1,
    totalIncl: Math.round(Number(r.IPIPrice) * 121) / 100,
    firstname: String(r.firstname ?? ''),
    middlename: String(r.middlename ?? ''),
    lastname: String(r.lastname ?? ''),
    email: String(r.email ?? ''),
    orgId: Number(r.org_id),
    orgName: String(r.org_name ?? '')
  }))
}

/** Zet de factuurstatus van deze cliënten van OPEN op PAYED. Alles-of-niets. */
export async function markPaid(conn: mysql.Connection, userIds: number[]): Promise<void> {
  if (userIds.length === 0) throw new Error('Kies minstens één factuur.')
  if (userIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error('Ongeldige cliënt.')
  await conn.beginTransaction()
  try {
    const [res] = await conn.query(
      "UPDATE users SET notes = REPLACE(notes, '<IPIFacStatus>OPEN</IPIFacStatus>', '<IPIFacStatus>PAYED</IPIFacStatus>') " +
        "WHERE id IN (?) AND role = 'client' AND instr(notes, '<IPIFacStatus>OPEN</IPIFacStatus>') > 0",
      [userIds]
    )
    const n = (res as mysql.ResultSetHeader).affectedRows
    if (n !== userIds.length) throw new Error(`Verwacht ${userIds.length} facturen bij te werken, maar het waren er ${n}. Er is niets gewijzigd; klik op "Vernieuwen".`)
    await conn.commit()
  } catch (e) {
    await conn.rollback().catch(() => {})
    throw e
  }
}

/** Haalt de betaalde facturen uit __openstaande_IPI_facturen.xlsx. Geeft het aantal verwijderde regels terug. */
export async function removeFromOverview(file: string, paid: { nr: string; userId: number }[]): Promise<number> {
  if (!fs.existsSync(file)) throw new Error(`Overzicht niet gevonden: ${file}`)
  if (isOpenInExcel(file)) throw new Error(`${OVERVIEW_FILE} is geopend in Excel. Sluit het en haal de regels er zelf uit, of probeer het opnieuw.`)
  const backupDir = path.join(localDataDir(), 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  fs.copyFileSync(file, path.join(backupDir, `${Date.now()}_${OVERVIEW_FILE}`))

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  const header = (ws.getRow(1).values as unknown[]).slice(1).map(String)
  if (OVERVIEW_COLUMNS.some((c, i) => header[i] !== c)) throw new Error(`De kolommen van ${OVERVIEW_FILE} zijn veranderd; het dashboard past het daarom niet aan.`)
  const keys = new Set(paid.map((p) => `${Number(p.nr)}|${p.userId}`))
  const remove: number[] = []
  ws.eachRow((row, nr) => {
    if (nr === 1) return
    const key = `${Number(row.getCell(1).value)}|${Number(row.getCell(3).value)}`
    if (keys.has(key)) remove.push(nr)
  })
  for (const nr of remove.reverse()) ws.spliceRows(nr, 1)
  if (remove.length) await wb.xlsx.writeFile(file)
  return remove.length
}
