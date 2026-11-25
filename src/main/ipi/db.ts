// IPI-facturatie: database (zelfde query's als Roberts 01_ipi_make_invoices.pl).
import mysql from 'mysql2/promise'
import { INVOICE_NAME_OVERRIDES, isEmail, notesSuffix, salutationOptions, type IpiClient, type IpiOrg } from '../../shared/ipi'
import type { DbLogin } from '../db/query'
import type { Tunnel } from '../db/tunnel'

const NOTE = (tag: string, col = 'u.notes'): string =>
  `substr(${col}, (instr(${col},'<${tag}>') + ${tag.length + 2}), instr(${col},'</${tag}>') - ${tag.length + 2} - instr(${col},'<${tag}>'))`

/** Cliënten na de licentiestartdatum zonder IPI-factuurnummer, bij organisaties met een IPI-prijs. */
const NEW_CLIENTS_SQL = `
select u.id, u.firstname, u.middlename, u.lastname, u.email, o.id as org_id,
       convert(${NOTE('IPIFacNr')}, UNSIGNED) as IPIFacNr
from users u join organizations o on o.id = u.organization_id
where u.organization_id in (
    select id from (
        select id, ${NOTE('IPIPrice', 'notes')} as IPIPrice from organizations o group by id having IPIPrice != ''
    ) as xxx)
  and u.role = 'client'
  and u.created_at > o.license_start_date
group by u.id
having IPIFacNr = 0
order by o.id, u.id`

const ORG_SQL = `
select o.id, o.name, o.billing_email, o.billing_contact_person,
       a.street, a.street_nr, a.street_nr_additional, a.postal_code, a.city,
       convert(${NOTE('DebNr', 'o.notes')}, UNSIGNED) as DebNr,
       convert(${NOTE('IPIPrice', 'o.notes')}, DECIMAL(10,2)) as IPIPrice
from organizations o
left join addresses a on o.billing_address_id = a.id
where o.id in (?)`

const MAX_NR_SQL = `
select convert(${NOTE('IPIFacNr', 'notes')}, UNSIGNED) as IPIFacNr
from users where organization_id is not null
group by id having IPIFacNr != ''
order by IPIFacNr desc limit 1`

export async function connect(tunnel: Tunnel, login: DbLogin): Promise<mysql.Connection> {
  const stream = await tunnel.forward()
  return mysql.createConnection({
    stream: stream as unknown as mysql.ConnectionOptions['stream'],
    user: login.user,
    password: login.password,
    database: login.database,
    charset: 'utf8mb4',
    dateStrings: true,
    supportBigNumbers: true,
    connectTimeout: 20000
  })
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

export async function maxInvoiceNr(conn: mysql.Connection): Promise<number> {
  const [rows] = await conn.query(MAX_NR_SQL)
  const r = (rows as { IPIFacNr: number | string }[])[0]
  return r ? Number(r.IPIFacNr) : 0
}

/** Alle organisaties met nieuwe IPI-cliënten, met factuurgegevens. Alleen lezen. */
export async function loadNewClients(conn: mysql.Connection): Promise<IpiOrg[]> {
  const [clientRows] = await conn.query(NEW_CLIENTS_SQL)
  const byOrg = new Map<number, IpiClient[]>()
  for (const r of clientRows as Record<string, unknown>[]) {
    const orgId = Number(r.org_id)
    byOrg.set(orgId, [
      ...(byOrg.get(orgId) ?? []),
      { userId: Number(r.id), firstname: str(r.firstname), middlename: str(r.middlename), lastname: str(r.lastname), email: str(r.email) }
    ])
  }
  if (byOrg.size === 0) return []
  const [orgRows] = await conn.query(ORG_SQL, [[...byOrg.keys()]])
  return (orgRows as Record<string, unknown>[]).map((o) => {
    const orgId = Number(o.id)
    const contact = str(o.billing_contact_person)
    const price = Number(o.IPIPrice)
    const org: IpiOrg = {
      orgId,
      name: str(o.name),
      invoiceName: INVOICE_NAME_OVERRIDES[orgId] ?? str(o.name),
      billingEmail: str(o.billing_email),
      contactPerson: contact,
      salutations: salutationOptions(contact),
      addressLine: [str(o.street), str(o.street_nr), str(o.street_nr_additional)].filter(Boolean).join(' '),
      postalCityLine: [str(o.postal_code), str(o.city)].filter(Boolean).join(' '),
      debNr: str(o.DebNr),
      priceExcl: price,
      clients: byOrg.get(orgId) ?? [],
      problems: []
    }
    if (!isEmail(org.billingEmail)) org.problems.push('Geen geldig factuur-e-mailadres bij de organisatie.')
    if (!org.addressLine || !org.postalCityLine) org.problems.push('Factuuradres ontbreekt bij de organisatie.')
    if (!(price > 0)) org.problems.push('Geen geldige IPI-prijs in de notities van de organisatie.')
    if (!org.debNr || org.debNr === '0') org.problems.push('Debiteurnummer ontbreekt in de notities van de organisatie.')
    return org
  }).sort((a, b) => a.name.localeCompare(b.name, 'nl'))
}

/**
 * Nummert de cliënten van één organisatie, alles-of-niets.
 * - Een databaseslot voorkomt dat twee mensen tegelijk nummeren.
 * - `prepare` maakt de bestanden; pas als dat lukt worden de nummers vastgelegd.
 * - Een cliënt die intussen al een nummer heeft, breekt alles af.
 */
export async function assignNumbers<T>(
  conn: mysql.Connection,
  orgId: number,
  userIds: number[],
  date: Date,
  prepare: (numbers: Map<number, number>) => Promise<T>,
  undo: () => void
): Promise<T> {
  const [[lock]] = (await conn.query("SELECT GET_LOCK('icares_dashboard_ipi', 20) AS ok")) as unknown as [{ ok: number }[]]
  if (lock?.ok !== 1) throw new Error('Iemand anders is op dit moment IPI-facturen aan het maken. Probeer het over een minuut opnieuw.')
  try {
    const current = (await loadNewClients(conn)).find((o) => o.orgId === orgId)
    const now = new Set(current?.clients.map((c) => c.userId) ?? [])
    if (now.size !== userIds.length || userIds.some((id) => !now.has(id))) {
      throw new Error('De lijst met nieuwe cliënten is intussen veranderd. Klik op "Vernieuwen" en controleer opnieuw.')
    }
    let nr = await maxInvoiceNr(conn)
    const numbers = new Map<number, number>()
    for (const id of [...userIds].sort((a, b) => a - b)) numbers.set(id, ++nr)

    let result: T
    try {
      result = await prepare(numbers)
    } catch (e) {
      undo()
      throw e
    }
    try {
      await conn.beginTransaction()
      for (const [userId, n] of numbers) {
        const [res] = await conn.query(
          `UPDATE users SET notes = CONCAT(IFNULL(notes, ''), ?) WHERE id = ? AND convert(${NOTE('IPIFacNr', 'notes')}, UNSIGNED) = 0`,
          [notesSuffix(n, date), userId]
        )
        if ((res as mysql.ResultSetHeader).affectedRows !== 1) throw new Error(`Cliënt ${userId} kon niet bijgewerkt worden (heeft al een factuurnummer?).`)
      }
      await conn.commit()
    } catch (e) {
      await conn.rollback().catch(() => {})
      undo()
      throw e
    }
    return result
  } finally {
    await conn.query("SELECT RELEASE_LOCK('icares_dashboard_ipi')").catch(() => {})
  }
}
