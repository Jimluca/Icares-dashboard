// Fontys-studenten aanmaken: Excel lezen, plan maken en uitvoeren tegen een nagebootste database.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { apply, buildSql, initialPasswordHash, plan, readExcel, subaddress } from '../src/main/fontys'
import { FONTYS_DEFAULTS } from '../src/shared/fontys'

async function excel(rows: unknown[][]): Promise<string> {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fontys-')), 'studenten.xlsx')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Blad1')
  ws.addRow(['studentnummer', 'email', 'voornaam', 'achternaam'])
  rows.forEach((r) => ws.addRow(r))
  await wb.xlsx.writeFile(f)
  return f
}

type U = { id: number; role: string; organization_id: number | null; email: string }
function db(users: U[], opts: { failInsertAt?: number } = {}) {
  const calls: string[] = []
  let inserts = 0
  return {
    calls,
    users,
    async query(sql: string, params: unknown[] = []) {
      if (/FROM organizations WHERE id/.test(sql)) return [params[0] === 275 ? [{ n: 'IMK Fontys' }] : []]
      if (/CONCAT_WS/.test(sql)) return [params[0] === 254396 ? [{ n: 'Wouter van Kempen <w@fontys.nl>' }] : []]
      if (/WHERE LOWER\(email\) IN/.test(sql)) return [users.filter((u) => (params[0] as string[]).includes(u.email.toLowerCase())).map((u) => ({ ...u }))]
      if (/WHERE LOWER\(email\) = LOWER\(\?\) LIMIT 1/.test(sql)) return [users.filter((u) => u.email.toLowerCase() === String(params[0]).toLowerCase())]
      if (/^UPDATE users SET email/.test(sql)) {
        calls.push(`update ${params[1]} -> ${params[0]}`)
        const u = users.find((x) => x.id === params[1] && x.email.toLowerCase() === String(params[2]).toLowerCase())
        if (u) u.email = String(params[0])
        return [{ affectedRows: u ? 1 : 0 }]
      }
      if (/^INSERT INTO `users`/.test(sql)) {
        inserts++
        if (opts.failInsertAt === inserts) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
        calls.push(`insert ${params[1]}`)
        return [{ affectedRows: 1 }]
      }
      throw new Error(`onverwachte query: ${sql.slice(0, 60)}`)
    },
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') }
  }
}

describe('Fontys', () => {
  it('leest kolommen A-D vanaf regel 2', async () => {
    const rows = await readExcel(await excel([[538069, '538069@Student.Fontys.nl', 'Anna', 'Jansen'], [], ['123', 'b@x.nl', 'Bo', 'Bakker']]))
    expect(rows).toEqual([
      { row: 2, studentNr: '538069', email: '538069@student.fontys.nl', firstname: 'Anna', lastname: 'Jansen' },
      { row: 4, studentNr: '123', email: 'b@x.nl', firstname: 'Bo', lastname: 'Bakker' }
    ])
  })

  it('beginwachtwoord = studentnummer achterstevoren, als Laravel-bcrypt', () => {
    const h = initialPasswordHash('538069')
    expect(h.startsWith('$2y$10$')).toBe(true)
    expect(bcrypt.compareSync('960835', h.replace(/^\$2y\$/, '$2b$'))).toBe(true)
  })

  it('subadres zoals Robert', () => {
    expect(subaddress('538069@student.fontys.nl', 'client')).toBe('538069+client@student.fontys.nl')
    expect(subaddress('538069+oud@student.fontys.nl', 'client')).toBe('538069+client@student.fontys.nl')
  })

  it('maakt een plan: nieuw, subadres, bestaat, fout', async () => {
    const d = db([
      { id: 10, role: 'client', organization_id: 1, email: '2222@student.fontys.nl' },
      { id: 11, role: 'professional', organization_id: 275, email: '3333@student.fontys.nl' }
    ])
    const rows = await readExcel(await excel([
      ['1111', '1111@student.fontys.nl', 'A', 'A'],
      ['2222', '2222@student.fontys.nl', 'B', 'B'],
      ['3333', '3333@student.fontys.nl', 'C', 'C'],
      ['abc', 'x@y.nl', 'D', 'D'],
      ['4444', 'geen-adres', 'E', 'E'],
      ['5555', '1111@student.fontys.nl', 'F', 'F']
    ]))
    const p = await plan(d as never, rows, FONTYS_DEFAULTS, 'test.xlsx')
    expect(p.organizationName).toBe('IMK Fontys')
    expect(p.rows.map((r) => r.action)).toEqual(['nieuw', 'subadres', 'bestaat', 'fout', 'fout', 'fout'])
    expect(p.rows[1].existing?.newEmail).toBe('2222+client@student.fontys.nl')

    const r = await apply(d as never, p, 'Test')
    expect(r).toEqual({ created: 2, readdressed: 1 })
    expect(d.calls).toEqual(['begin', 'update 10 -> 2222+client@student.fontys.nl', 'insert 1111@student.fontys.nl', 'insert 2222@student.fontys.nl', 'commit'])

    const sql = buildSql(p, 'Test')
    expect(sql).toContain("UPDATE users SET email = '2222+client@student.fontys.nl' WHERE id = 10")
    expect(sql).toContain("'1111@student.fontys.nl'")
    expect(sql).not.toContain('3333@')
    expect(sql.trim().endsWith('COMMIT;')).toBe(true)
  })

  it('rolt alles terug als een aanmaak mislukt', async () => {
    const d = db([], { failInsertAt: 2 })
    const rows = await readExcel(await excel([['1001', 'a@x.nl', 'A', 'A'], ['1002', 'b@x.nl', 'B', 'B']]))
    const p = await plan(d as never, rows, FONTYS_DEFAULTS, 'x.xlsx')
    await expect(apply(d as never, p, 'Test')).rejects.toThrow(/niets aangepast/)
    expect(d.calls.at(-1)).toBe('rollback')
  })

  it('weigert een onbekende organisatie', async () => {
    const rows = await readExcel(await excel([['1', 'a@x.nl', 'A', 'A']]))
    await expect(plan(db([]) as never, rows, { ...FONTYS_DEFAULTS, organizationId: 9999 }, 'x')).rejects.toThrow(/bestaat niet/)
  })

  const real = path.join(os.homedir(), 'Icares B.V', 'MT - Documents', 'Scripts', 'IcaresImportUsers', 'excel_aangeleverd_2026_11_04', 'student_nummers_input_periode_november_26.xlsx')
  it.skipIf(!fs.existsSync(real))('kan Roberts echte Fontys-bestand inlezen', async () => {
    const rows = await readExcel(real)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => /^\d+$/.test(r.studentNr) && r.email.includes('@'))).toBe(true)
  })
})
