// Personen verwijderen: organisatie zoeken, mensen tonen, verwijderen via het platform
// en daarna in de database controleren dat het gelukt is.
import type mysql from 'mysql2/promise'
import type { OrgPerson, OrgSearchHit, DeleteOutcome } from '../../shared/people'
import { DELETABLE_ROLES } from '../../shared/people'
import { connect } from '../ipi/db'
import { dbLogin, ensureOpen, tunnel } from '../db/service'
import type { VaultSession } from '../vault/vault'
import { totpCode } from '../vault/totp'
import { PlatformClient } from './client'
import { setEmail as dbSetEmail, setStatus as dbSetStatus, statusOptions as dbStatusOptions } from './edit'
import { audit } from '../audit'

export const PLATFORM_URL = 'https://platform.icares.com'
const ENTRY_TITLE = 'Icares Professional beheerder'

let client: PlatformClient | null = null

async function withDb<T>(s: VaultSession, fn: (c: mysql.Connection) => Promise<T>): Promise<T> {
  await ensureOpen(s)
  const conn = await connect(tunnel, dbLogin(s))
  try {
    return await fn(conn)
  } finally {
    await conn.end().catch(() => conn.destroy())
  }
}

async function hasDeletedAt(conn: mysql.Connection): Promise<boolean> {
  const [rows] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'deleted_at'")
  return Number((rows as { n: number }[])[0]?.n) > 0
}

export async function searchOrgs(s: VaultSession, q: string): Promise<OrgSearchHit[]> {
  const term = q.trim()
  if (term.length < 2) return []
  return withDb(s, async (conn) => {
    const live = (await hasDeletedAt(conn)) ? 'and u.deleted_at is null' : ''
    const [rows] = await conn.query(
      `select o.id, o.name, (select count(*) from users u where u.organization_id = o.id ${live}) as people
       from organizations o where o.name like ? or o.id = ? order by o.name limit 30`,
      [`%${term.replace(/[%_]/g, '\\$&')}%`, Number(term) || -1]
    )
    return (rows as { id: number; name: string; people: number }[]).map((r) => ({ id: Number(r.id), name: String(r.name), people: Number(r.people) }))
  })
}

export async function orgPeople(s: VaultSession, orgId: number): Promise<OrgPerson[]> {
  return withDb(s, async (conn) => {
    const live = (await hasDeletedAt(conn)) ? 'and u.deleted_at is null' : ''
    const [rows] = await conn.query(
      `select u.id, u.role, u.status, u.firstname, u.middlename, u.lastname, u.email, u.created_at,
              (select count(*) from clients_professionals cp where cp.professional_user_id = u.id) as clients,
              (select group_concat(distinct p.email separator ', ') from clients_professionals cp join users p on p.id = cp.professional_user_id where cp.client_user_id = u.id) as professionals
       from users u where u.organization_id = ? ${live}
       order by field(u.role, 'organization manager', 'professional', 'client'), u.lastname, u.firstname`,
      [orgId]
    )
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      role: String(r.role ?? ''),
      status: String(r.status ?? ''),
      name: [r.firstname, r.middlename, r.lastname].map((x) => String(x ?? '').trim()).filter(Boolean).join(' '),
      email: String(r.email ?? ''),
      createdAt: String(r.created_at ?? '').slice(0, 10),
      clients: Number(r.clients ?? 0),
      professionals: String(r.professionals ?? '')
    }))
  })
}

function login(s: VaultSession): { login: string; password: string; totp: () => string } {
  const cfgId = s.getConfig().platformEntryId
  const e = s.findConfigured(cfgId, ENTRY_TITLE)
  if (!e) throw new Error(`Geen toegang tot het kluisitem "${ENTRY_TITLE} (verwijderen)" of het bestaat niet.`)
  if (!e.username || !e.password) throw new Error(`Vul in de kluis bij "${e.title}" de login en het wachtwoord van het beheerdersaccount in.`)
  // Zonder 2FA-sleutel sturen we een leeg 2FA-veld mee (voor accounts zonder 2FA)
  const t = e.totp
  return { login: e.username, password: e.password, totp: () => (t ? totpCode(t).code : '') }
}

async function ensureClient(s: VaultSession): Promise<PlatformClient> {
  const cred = login(s)
  if (!client || !client.isLoggedIn) {
    client = new PlatformClient(PLATFORM_URL)
    await client.login(cred)
  }
  return client
}

/** Logt in en controleert of het verwijderformulier van deze persoon te vinden is, zonder te verwijderen. */
export async function dryRun(s: VaultSession, userId: number): Promise<string> {
  const c = await ensureClient(s)
  await c.deleteUser(userId, false)
  return 'Inloggen gelukt en het verwijderformulier is gevonden. Er is niets verwijderd.'
}

export async function deletePerson(s: VaultSession, orgId: number, userId: number): Promise<DeleteOutcome> {
  // Eerst in de database controleren wie dit is
  const person = (await orgPeople(s, orgId)).find((p) => p.id === userId)
  if (!person) throw new Error('Deze persoon hoort niet (meer) bij de gekozen organisatie. Ververs de lijst.')
  if (!DELETABLE_ROLES.includes(person.role)) throw new Error(`Personen met de rol "${person.role}" kun je hier niet verwijderen.`)
  const cred = login(s)
  if (person.email && person.email.toLowerCase() === cred.login.toLowerCase()) throw new Error('Je kunt het beheerdersaccount waarmee het dashboard inlogt niet verwijderen.')

  const c = await ensureClient(s)
  await c.deleteUser(userId, true)

  // Controle: is de persoon echt weg?
  const gone = await withDb(s, async (conn) => {
    const soft = await hasDeletedAt(conn)
    const [rows] = await conn.query(`select id${soft ? ', deleted_at' : ''} from users where id = ?`, [userId])
    const r = (rows as { id: number; deleted_at?: string | null }[])[0]
    return !r || (soft && !!r.deleted_at)
  })
  if (!gone) throw new Error(`Het platform gaf geen foutmelding, maar ${person.name || userId} staat nog in de database. Controleer dit in Icares Professional.`)
  audit(s.info().name, 'verwijderd', userId, `${person.name} | ${person.role} | ${person.email} | org ${orgId}`)
  return { userId, name: person.name, role: person.role }
}

/** E-mail van het beheerdersaccount (mag niet via het dashboard gewijzigd worden), zonder fout als het nog niet is ingevuld. */
function protectedLogin(s: VaultSession): string {
  return s.findConfigured(s.getConfig().platformEntryId, ENTRY_TITLE)?.username ?? ''
}

export async function statusOptions(s: VaultSession): Promise<string[]> {
  return withDb(s, (conn) => dbStatusOptions(conn))
}

export async function setStatus(s: VaultSession, orgId: number, userId: number, status: string): Promise<string> {
  const r = await withDb(s, (conn) => dbSetStatus(conn, orgId, userId, status, protectedLogin(s)))
  if (r.from !== r.to) audit(s.info().name, 'status gewijzigd', userId, `${r.from} -> ${r.to} | ${r.email} | org ${orgId}`)
  return r.to
}

export async function setEmail(s: VaultSession, orgId: number, userId: number, email: string): Promise<string> {
  const r = await withDb(s, (conn) => dbSetEmail(conn, orgId, userId, email, protectedLogin(s)))
  if (r.from !== r.to) audit(s.info().name, 'e-mail gewijzigd', userId, `${r.from} -> ${r.to} | org ${orgId}`)
  return r.to
}

export function resetPlatformSession(): void {
  client = null
}
