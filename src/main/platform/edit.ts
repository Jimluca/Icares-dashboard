// Status en e-mailadres van een persoon wijzigen, rechtstreeks en gericht in de database:
// er wordt precies één veld aangepast, de rest van het record (zoals het notitieveld) blijft onaangeroerd.
import type mysql from 'mysql2/promise'
import { isEmail } from '../../shared/ipi'
import { STATUS_ROLES } from '../../shared/people'

export interface PersonRow {
  id: number
  role: string
  status: string
  email: string
  organization_id: number
}

async function loadPerson(conn: mysql.Connection, orgId: number, userId: number): Promise<PersonRow> {
  const [rows] = await conn.query('SELECT id, role, status, email, organization_id FROM users WHERE id = ?', [userId])
  const p = (rows as PersonRow[])[0]
  if (!p || Number(p.organization_id) !== orgId) throw new Error('Deze persoon hoort niet (meer) bij de gekozen organisatie. Ververs de lijst.')
  return p
}

/** De statussen die de database toestaat (uit de kolomdefinitie), of de bekende als dat geen keuzelijst is. */
export async function statusOptions(conn: mysql.Connection): Promise<string[]> {
  const [rows] = await conn.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'status'"
  )
  const t = String((rows as { t: string }[])[0]?.t ?? '')
  const m = t.match(/^enum\((.*)\)$/i)
  if (m) return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"))
  const [vals] = await conn.query('SELECT DISTINCT status FROM users WHERE status IS NOT NULL ORDER BY status')
  const found = (vals as { status: string }[]).map((v) => String(v.status))
  return found.length ? found : ['active', 'blocked']
}

export async function setStatus(conn: mysql.Connection, orgId: number, userId: number, status: string, protectedEmail: string): Promise<{ from: string; to: string; email: string }> {
  const p = await loadPerson(conn, orgId, userId)
  if (!STATUS_ROLES.includes(p.role)) throw new Error('Alleen bij professionals en organisatiemanagers kun je hier de status wijzigen.')
  if (p.email.toLowerCase() === protectedEmail.toLowerCase()) throw new Error('Dit is het beheerdersaccount waarmee het dashboard werkt; dat kun je hier niet wijzigen.')
  const options = await statusOptions(conn)
  if (!options.includes(status)) throw new Error(`Onbekende status "${status}".`)
  if (p.status === status) return { from: p.status, to: status, email: p.email }
  const [res] = await conn.query('UPDATE users SET status = ? WHERE id = ? AND organization_id = ? AND status = ?', [status, userId, orgId, p.status])
  if ((res as mysql.ResultSetHeader).affectedRows !== 1) throw new Error('De status is intussen door iemand anders gewijzigd. Ververs de lijst.')
  return { from: p.status, to: status, email: p.email }
}

export async function setEmail(conn: mysql.Connection, orgId: number, userId: number, email: string, protectedEmail: string): Promise<{ from: string; to: string }> {
  const next = email.trim()
  if (!isEmail(next) || next.length > 191) throw new Error('Dit is geen geldig e-mailadres.')
  const p = await loadPerson(conn, orgId, userId)
  if (p.email.toLowerCase() === protectedEmail.toLowerCase()) throw new Error('Dit is het beheerdersaccount waarmee het dashboard werkt; wijzig het e-mailadres daarvan in Icares Professional zelf.')
  if (p.email === next) return { from: p.email, to: next }
  const [dupes] = await conn.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1', [next, userId])
  const dupe = (dupes as { id: number }[])[0]
  if (dupe) throw new Error(`Dit e-mailadres is al in gebruik bij een andere gebruiker (user-id ${dupe.id}).`)
  const [res] = await conn.query('UPDATE users SET email = ? WHERE id = ? AND organization_id = ? AND email = ?', [next, userId, orgId, p.email])
  if ((res as mysql.ResultSetHeader).affectedRows !== 1) throw new Error('Het e-mailadres is intussen door iemand anders gewijzigd. Ververs de lijst.')
  return { from: p.email, to: next }
}
