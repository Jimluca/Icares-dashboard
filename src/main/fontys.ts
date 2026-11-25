// Fontys-studenten als professional aanmaken, zoals Roberts 01_create_insert_clients_sql_script.pl,
// maar met controles vooraf en het subadresseren van bestaande accounts ingebouwd.
import bcrypt from 'bcryptjs'
import ExcelJS from 'exceljs'
import type mysql from 'mysql2/promise'
import { isEmail } from '../shared/ipi'
import type { FontysPlan, FontysPlanRow, FontysRow, FontysSettings } from '../shared/fontys'

const text = (c: ExcelJS.Cell): string => String(c.text ?? '').trim()

/** Leest kolom A (studentnummer), B (e-mail), C (voornaam), D (achternaam) vanaf regel 2 van het eerste werkblad. */
export async function readExcel(file: string): Promise<FontysRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('Het Excel-bestand heeft geen werkblad.')
  const rows: FontysRow[] = []
  ws.eachRow((r, nr) => {
    if (nr === 1) return
    const row = { row: nr, studentNr: text(r.getCell(1)), email: text(r.getCell(2)).toLowerCase(), firstname: text(r.getCell(3)), lastname: text(r.getCell(4)) }
    if (row.studentNr || row.email || row.firstname || row.lastname) rows.push(row)
  })
  if (rows.length === 0) throw new Error('Geen studenten gevonden. Verwacht: kolom A studentnummer, B e-mail, C voornaam, D achternaam, vanaf regel 2.')
  return rows
}

/** "538069@student.fontys.nl" + "client" -> "538069+client@student.fontys.nl" */
export function subaddress(email: string, tag: string): string {
  const [local, domain] = email.split('@')
  return `${local.split('+')[0]}+${tag}@${domain}`
}

const TAG: Record<string, string> = { client: 'client', professional: 'professional', 'organization manager': 'manager' }

async function name(conn: mysql.Connection, sql: string, id: number): Promise<string> {
  const [rows] = await conn.query(sql, [id])
  const r = (rows as { n: string }[])[0]
  return r ? String(r.n).trim() : ''
}

/** Bepaalt per regel wat er gaat gebeuren. Wijzigt niets. */
export async function plan(conn: mysql.Connection, rows: FontysRow[], settings: FontysSettings, file: string): Promise<FontysPlan> {
  const organizationName = await name(conn, 'SELECT name AS n FROM organizations WHERE id = ?', settings.organizationId)
  if (!organizationName) throw new Error(`Organisatie ${settings.organizationId} bestaat niet.`)
  const createdByName = await name(conn, "SELECT CONCAT_WS(' ', firstname, middlename, lastname, CONCAT('<', email, '>')) AS n FROM users WHERE id = ?", settings.createdBy)
  if (!createdByName) throw new Error(`Gebruiker ${settings.createdBy} ("aangemaakt door") bestaat niet.`)

  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))]
  const existing = new Map<string, { id: number; role: string; organization_id: number | null; email: string }>()
  if (emails.length) {
    const [found] = await conn.query('SELECT id, role, organization_id, email FROM users WHERE LOWER(email) IN (?)', [emails])
    for (const f of found as { id: number; role: string; organization_id: number | null; email: string }[]) existing.set(String(f.email).toLowerCase(), f)
  }
  const seen = new Set<string>()
  const out: FontysPlanRow[] = []
  for (const r of rows) {
    const bad = (message: string): void => void out.push({ ...r, action: 'fout', message })
    if (!/^\d{3,10}$/.test(r.studentNr)) { bad('Studentnummer ontbreekt of is geen getal.'); continue }
    if (!isEmail(r.email)) { bad('Geen geldig e-mailadres.'); continue }
    if (!r.firstname || !r.lastname) { bad('Voornaam of achternaam ontbreekt.'); continue }
    if (seen.has(r.email)) { bad('Dit e-mailadres staat dubbel in het bestand.'); continue }
    seen.add(r.email)
    const ex = existing.get(r.email)
    if (!ex) {
      out.push({ ...r, action: 'nieuw', message: 'Wordt aangemaakt.' })
    } else if (ex.role === 'professional' && Number(ex.organization_id) === settings.organizationId) {
      out.push({ ...r, action: 'bestaat', message: `Bestaat al als professional bij deze organisatie (user-id ${ex.id}); wordt overgeslagen.`, existing: { id: ex.id, role: ex.role, organizationId: ex.organization_id } })
    } else {
      const newEmail = subaddress(r.email, TAG[ex.role] ?? 'oud')
      const [taken] = await conn.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [newEmail])
      if ((taken as unknown[]).length) {
        bad(`Bestaand account (user-id ${ex.id}, ${ex.role}) kan niet hernoemd worden: ${newEmail} is ook al in gebruik.`)
        continue
      }
      out.push({
        ...r,
        action: 'subadres',
        message: `Bestaand account (user-id ${ex.id}, ${ex.role}) wordt hernoemd naar ${newEmail}; daarna nieuw account.`,
        existing: { id: ex.id, role: ex.role, organizationId: ex.organization_id, newEmail }
      })
    }
  }
  return { settings, organizationName, createdByName, rows: out, file }
}

/** Beginwachtwoord zoals Robert: het studentnummer achterstevoren, als Laravel-bcrypt ($2y$). */
export function initialPasswordHash(studentNr: string): string {
  return bcrypt.hashSync([...studentNr].reverse().join(''), 10).replace(/^\$2[ab]\$/, '$2y$')
}

const NOTES = (nr: string, by: string): string => `Fontys studentnummer: ${nr} automatisch aangemaakt als nieuwe professional via Icares Dashboard (${by})\n`

const INSERT_COLUMNS =
  '(`created_by`,`email`,`password`,`organization_id`,`original_organization_id`,`firstname`,`middlename`,`lastname`,`status`,`country_region_id`,`country_id`,`language_id`,`phone`,`role`,`notes`,`accepted_agreements_at`)'

function insertValues(p: FontysPlan, r: FontysPlanRow, by: string): unknown[] {
  const s = p.settings
  return [s.createdBy, r.email, initialPasswordHash(r.studentNr), s.organizationId, s.organizationId, r.firstname, '', r.lastname, 'active', s.countryRegionId, s.countryId, s.languageId, '', 'professional', NOTES(r.studentNr, by)]
}

/** Voert het plan uit in één transactie: eerst subadresseren, dan aanmaken. Alles of niets. */
export async function apply(conn: mysql.Connection, p: FontysPlan, by: string): Promise<{ created: number; readdressed: number }> {
  const sub = p.rows.filter((r) => r.action === 'subadres')
  const create = p.rows.filter((r) => r.action === 'nieuw' || r.action === 'subadres')
  if (create.length === 0) throw new Error('Er is niets aan te maken.')
  await conn.beginTransaction()
  try {
    for (const r of sub) {
      const [res] = await conn.query('UPDATE users SET email = ? WHERE id = ? AND LOWER(email) = LOWER(?)', [r.existing!.newEmail, r.existing!.id, r.email])
      if ((res as mysql.ResultSetHeader).affectedRows !== 1) throw new Error(`Account ${r.existing!.id} kon niet hernoemd worden (intussen gewijzigd?). Er is niets aangepast.`)
    }
    for (const r of create) {
      await conn.query(`INSERT INTO \`users\` ${INSERT_COLUMNS} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`, insertValues(p, r, by))
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback().catch(() => {})
    const err = e as { code?: string; message: string }
    if (err.code === 'ER_DUP_ENTRY') throw new Error('Een van de e-mailadressen bestaat intussen al. Er is niets aangepast; controleer opnieuw.')
    throw e
  }
  return { created: create.length, readdressed: sub.length }
}

const q = (v: unknown): string => (typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`)

/** Het plan als SQL-bestand, zoals Robert het maakte (voor wie het liever zelf in MySQL Workbench draait). */
export function buildSql(p: FontysPlan, by: string): string {
  const sub = p.rows.filter((r) => r.action === 'subadres')
  const create = p.rows.filter((r) => r.action === 'nieuw' || r.action === 'subadres')
  const lines = ['-- Gemaakt door het Icares Dashboard', `-- Bron: ${p.file}`, `-- Organisatie: ${p.settings.organizationId} ${p.organizationName}`, 'SET AUTOCOMMIT = 0;', '']
  for (const r of sub) lines.push(`UPDATE users SET email = ${q(r.existing!.newEmail)} WHERE id = ${r.existing!.id} AND email = ${q(r.email)};`)
  if (sub.length) lines.push('')
  if (create.length) {
    lines.push(`INSERT INTO \`users\`\n${INSERT_COLUMNS}\nVALUES`)
    lines.push(create.map((r) => `(${insertValues(p, r, by).map(q).join(', ')}, NOW())`).join(',\n') + ';')
  }
  lines.push('', 'COMMIT;')
  return lines.join('\n')
}
