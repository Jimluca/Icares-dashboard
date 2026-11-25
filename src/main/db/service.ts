// Verbindt kluis, instellingen, tunnel en database met elkaar.
import fs from 'node:fs'
import path from 'node:path'
import type { DbConfigView, Institution, QueryResult, TunnelState } from '../../shared/ipc'
import { SCRIPTS } from '../../shared/scripts'
import type { Entry } from '../../shared/types'
import { loadSettings, saveSettings } from '../settings'
import type { VaultSession } from '../vault/vault'
import { cleanSql, runReadOnly } from './query'
import { Tunnel, validatePrivateKey } from './tunnel'
import { scriptFile } from '../bundled'

const TUNNEL_TITLE = 'SSH-sleutel productie'
const DB_TITLE = 'MySQL productie'

let notify: (s: TunnelState) => void = () => {}
export function onTunnelChange(fn: (s: TunnelState) => void): void {
  notify = fn
}

export const tunnel = new Tunnel(
  (s) => notify(s),
  (fp) => {
    const st = loadSettings()
    saveSettings({ ...st, knownHosts: { ...st.knownHosts, [st.tunnel.host]: fp } })
  }
)

function entries(s: VaultSession): { key: Entry | null; db: Entry | null } {
  const cfg = s.getConfig()
  return { key: s.findConfigured(cfg.tunnelEntryId, TUNNEL_TITLE), db: s.findConfigured(cfg.dbEntryId, DB_TITLE) }
}

/** Wat ontbreekt er nog om verbinding te maken? Leeg = klaar. */
export function problems(s: VaultSession): string[] {
  const { key, db } = entries(s)
  const out: string[] = []
  if (!key) out.push('Je hebt geen toegang tot het kluisitem met de SSH-sleutel (of het bestaat niet).')
  else if (!key.privateKey) out.push(`Het SSH-sleutelbestand is nog niet in de kluis gezet (item "${key.title}"). Super admin: Beheer > Database-koppeling > "SSH-sleutel importeren".`)
  if (!db) out.push('Je hebt geen toegang tot het kluisitem met het databasewachtwoord (of het bestaat niet).')
  else if (!db.username || !db.password) out.push(`Gebruikersnaam of wachtwoord ontbreekt bij "${db.title}".`)
  return out
}

export async function openTunnel(s: VaultSession): Promise<void> {
  const p = problems(s)
  if (p.length) throw new Error(p[0])
  const { key } = entries(s)
  const st = loadSettings()
  await tunnel.open({
    host: st.tunnel.host,
    user: st.tunnel.user,
    privateKey: key!.privateKey!,
    passphrase: key!.password,
    remotePort: st.tunnel.remotePort,
    localPort: st.tunnel.localPort,
    knownFingerprint: st.knownHosts[st.tunnel.host]
  })
}

export function dbLogin(s: VaultSession): { user: string; password: string; database: string } {
  const { db } = entries(s)
  if (!db?.username || !db.password) throw new Error('Geen databasegegevens beschikbaar in de kluis.')
  return { user: db.username, password: db.password, database: loadSettings().tunnel.database }
}

export async function ensureOpen(s: VaultSession): Promise<void> {
  if (!tunnel.status().open) await openTunnel(s)
}

export async function runScriptSql(s: VaultSession, scriptId: string): Promise<QueryResult> {
  const def = SCRIPTS.find((d) => d.id === scriptId)
  if (!def || def.kind !== 'sql') throw new Error('Dit is geen SQL-script.')
  const f = scriptFile(path.join(def.folder, def.file))
  if (!f.exists) throw new Error(`SQL-bestand niet gevonden: ${f.path}`)
  const sql = cleanSql(fs.readFileSync(f.path, 'utf8'))
  await ensureOpen(s)
  return runReadOnly(tunnel, dbLogin(s), sql)
}

export async function testDb(s: VaultSession): Promise<string> {
  await ensureOpen(s)
  const r = await runReadOnly(tunnel, dbLogin(s), 'SELECT VERSION() AS versie, DATABASE() AS db, (SELECT COUNT(*) FROM organizations) AS organisaties')
  const [v, db, orgs] = r.rows[0] ?? []
  return `Verbonden met database "${db}" (MySQL ${v}); ${orgs} organisaties.`
}

// ---------- linkchecker ----------
function linkSqlFile(): string {
  const def = SCRIPTS.find((d) => d.id === 'linkchecker')!
  return scriptFile(path.join(def.folder, def.file)).path
}

/** Leest de lijst met instellingen uit de commentaarregels in Roberts SQL-bestand. */
export function linkInstitutions(): Institution[] {
  const file = linkSqlFile()
  if (!fs.existsSync(file)) throw new Error(`Bestand niet gevonden: ${file}`)
  const seen = new Map<number, string>()
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/educ_institution\.id\s*=\s*(\d+)\s*--\s*(.+)/g)) {
    const id = Number(m[1])
    if (!seen.has(id)) seen.set(id, m[2].trim())
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'nl'))
}

const LINK_SQL = `select
    educ_institution.id \`education institution id\`,
    educ_institution.name \`education institution name\`,
    ei.id \`education instance id\`,
    ei.name \`education instance name\`,
    eiv.id \`education instance variance id\`,
    eiv.website \`education instance variance website\`
from
    education_instance_variants eiv
    join education_instance_links eil on eil.id = eiv.education_instance_link_id
    join education_instances ei on ei.id = eil.education_instance_id
    join educational_institutions educ_institution on educ_institution.id = eil.educational_institution_id
where educ_institution.id = ?
order by ei.name asc`

export async function linkUrlsFromDb(s: VaultSession, institutionId: number): Promise<QueryResult> {
  if (!Number.isInteger(institutionId) || institutionId <= 0) throw new Error('Ongeldige instelling.')
  await ensureOpen(s)
  return runReadOnly(tunnel, dbLogin(s), LINK_SQL, [institutionId])
}

// ---------- beheer ----------
export function dbConfigView(s: VaultSession, groupName: (id: string) => string): DbConfigView {
  const { key, db } = entries(s)
  return {
    tunnelEntryId: key?.id ?? null,
    dbEntryId: db?.id ?? null,
    candidates: s
      .listEntries()
      .filter((e) => e.kind === 'login')
      .map((e) => ({ id: e.id, title: e.title, hasPrivateKey: !!e.privateKey, groupName: groupName(e.groupId) }))
      .sort((a, b) => a.title.localeCompare(b.title, 'nl')),
    problems: problems(s)
  }
}

export function importKey(s: VaultSession, entryId: string, file: string): void {
  const stat = fs.statSync(file)
  if (stat.size > 64 * 1024) throw new Error('Dit bestand is te groot voor een SSH-sleutel.')
  const text = fs.readFileSync(file, 'utf8')
  const entry = s.getEntry(entryId)
  validatePrivateKey(text, entry.password)
  s.setPrivateKey(entryId, text)
  // Sleutel veranderd: tunnel opnieuw opbouwen bij het volgende gebruik
  tunnel.close()
}
