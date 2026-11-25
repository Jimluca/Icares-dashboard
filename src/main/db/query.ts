// SQL uitvoeren over de tunnel, altijd ALLEEN-LEZEN.
import ExcelJS from 'exceljs'
import mysql from 'mysql2/promise'
import type { QueryResult } from '../../shared/ipc'
import type { Tunnel } from './tunnel'

export interface DbLogin {
  user: string
  password: string
  database: string
}

const MAX_ROWS = 20000

/** Haalt commentaar en een afsluitende ; weg, en weigert meerdere statements. */
export function cleanSql(sql: string): string {
  const noBlock = sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const lines = noBlock.split(/\r?\n/).map((l) => stripLineComment(l))
  const s = lines.join('\n').trim().replace(/;\s*$/, '').trim()
  if (!s) throw new Error('Het SQL-bestand is leeg.')
  if (s.includes(';')) throw new Error('Het SQL-bestand bevat meerdere statements; dat ondersteunt het dashboard niet.')
  if (!/^(select|with|show|describe|explain)\b/i.test(s)) throw new Error('Alleen SELECT-query\'s kunnen in het dashboard draaien.')
  return s
}

/** Verwijdert "-- ..." en "# ..." commentaar, maar niet binnen aanhalingstekens. */
function stripLineComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '#' || (ch === '-' && line[i + 1] === '-' && /\s|$/.test(line[i + 2] ?? ''))) return line.slice(0, i)
  }
  return line
}

function cell(v: unknown): string | number | null {
  if (v === null || v === undefined) return null
  if (Buffer.isBuffer(v)) return v.toString('utf8')
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  return String(v)
}

export async function runReadOnly(tunnel: Tunnel, login: DbLogin, sql: string, params: unknown[] = []): Promise<QueryResult> {
  const stream = await tunnel.forward()
  const conn = await mysql.createConnection({
    stream: stream as unknown as mysql.ConnectionOptions['stream'],
    user: login.user,
    password: login.password,
    database: login.database,
    charset: 'utf8mb4',
    // Datums precies zoals MySQL ze geeft; anders verschuift een DATE door omrekenen naar UTC
    dateStrings: true,
    supportBigNumbers: true,
    connectTimeout: 20000
  })
  const started = Date.now()
  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY')
    await conn.query('START TRANSACTION READ ONLY')
    const [rows, fields] = await conn.query({ sql, values: params, rowsAsArray: true, timeout: 120000 })
    await conn.query('ROLLBACK')
    const list = rows as unknown[][]
    return {
      columns: (fields ?? []).map((f) => f.name),
      rows: list.slice(0, MAX_ROWS).map((r) => r.map(cell)),
      truncated: list.length > MAX_ROWS,
      ms: Date.now() - started
    }
  } catch (e) {
    const err = e as { code?: string; message: string }
    if (err.code === 'ER_ACCESS_DENIED_ERROR') throw new Error('De database weigert de gebruikersnaam of het wachtwoord uit de kluis.')
    throw new Error(`Databasefout: ${err.message}`)
  } finally {
    await conn.end().catch(() => conn.destroy())
  }
}

export async function writeXlsx(file: string, sheetName: string, result: { columns: string[]; rows: (string | number | null)[][] }): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, '-') || 'Resultaat')
  ws.addRow(result.columns)
  ws.getRow(1).font = { bold: true }
  for (const r of result.rows) ws.addRow(r)
  ws.columns.forEach((col, i) => {
    const len = Math.max(result.columns[i]?.length ?? 8, ...result.rows.slice(0, 200).map((r) => String(r[i] ?? '').length))
    col.width = Math.min(60, Math.max(8, len + 2))
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, result.columns.length) } }
  await wb.xlsx.writeFile(file)
}

export function toTsv(result: { columns: string[]; rows: (string | number | null)[][] }, withHeader = true): string {
  const esc = (v: string | number | null): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ')
  const lines = result.rows.map((r) => r.map(esc).join('\t'))
  return (withHeader ? [result.columns.map(esc).join('\t'), ...lines] : lines).join('\r\n')
}
