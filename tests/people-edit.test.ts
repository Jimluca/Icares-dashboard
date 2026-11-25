// Status en e-mail wijzigen, tegen een nagebootste database.
import { describe, expect, it } from 'vitest'
import { setEmail, setStatus, statusOptions } from '../src/main/platform/edit'

type Row = { id: number; role: string; status: string; email: string; organization_id: number }

function db(rows: Row[], enumType = "enum('active','inactive','blocked')") {
  const updates: unknown[][] = []
  return {
    rows,
    updates,
    async query(sql: string, params: unknown[] = []) {
      if (/information_schema/.test(sql)) return [[{ t: enumType }]]
      if (/^SELECT DISTINCT status/.test(sql)) return [[...new Set(rows.map((r) => r.status))].map((status) => ({ status }))]
      if (/^SELECT id, role, status, email, organization_id FROM users WHERE id = \?/.test(sql)) return [rows.filter((r) => r.id === params[0]).map((r) => ({ ...r }))]
      if (/^SELECT id FROM users WHERE LOWER\(email\)/.test(sql)) return [rows.filter((r) => r.email.toLowerCase() === String(params[0]).toLowerCase() && r.id !== params[1])]
      if (/^UPDATE users SET status/.test(sql)) {
        updates.push(params)
        const r = rows.find((x) => x.id === params[1] && x.organization_id === params[2] && x.status === params[3])
        if (r) r.status = String(params[0])
        return [{ affectedRows: r ? 1 : 0 }]
      }
      if (/^UPDATE users SET email/.test(sql)) {
        updates.push(params)
        const r = rows.find((x) => x.id === params[1] && x.organization_id === params[2] && x.email === params[3])
        if (r) r.email = String(params[0])
        return [{ affectedRows: r ? 1 : 0 }]
      }
      throw new Error(`onverwachte query: ${sql}`)
    }
  }
}

const people = (): Row[] => [
  { id: 1, role: 'professional', status: 'active', email: 'prof@org.nl', organization_id: 9 },
  { id: 2, role: 'organization manager', status: 'active', email: 'man@org.nl', organization_id: 9 },
  { id: 3, role: 'client', status: 'active', email: 'cli@org.nl', organization_id: 9 },
  { id: 4, role: 'professional', status: 'active', email: 'beheer@icares.nl', organization_id: 9 },
  { id: 5, role: 'professional', status: 'active', email: 'ander@org.nl', organization_id: 77 }
]

describe('status', () => {
  it('leest de toegestane statussen uit de database', async () => {
    expect(await statusOptions(db(people()) as never)).toEqual(['active', 'inactive', 'blocked'])
    expect(await statusOptions(db(people(), 'varchar(20)') as never)).toEqual(['active'])
  })

  it('zet een professional op non-actief en weer terug', async () => {
    const d = db(people())
    expect(await setStatus(d as never, 9, 1, 'inactive', 'beheer@icares.nl')).toEqual({ from: 'active', to: 'inactive', email: 'prof@org.nl' })
    expect(d.rows[0].status).toBe('inactive')
    await setStatus(d as never, 9, 1, 'active', 'beheer@icares.nl')
    expect(d.rows[0].status).toBe('active')
  })

  it('werkt ook voor een manager, niet voor een cliënt', async () => {
    const d = db(people())
    await setStatus(d as never, 9, 2, 'blocked', '')
    expect(d.rows[1].status).toBe('blocked')
    await expect(setStatus(d as never, 9, 3, 'inactive', '')).rejects.toThrow(/professionals en organisatiemanagers/)
  })

  it('weigert onbekende status, andere organisatie en het beheerdersaccount', async () => {
    const d = db(people())
    await expect(setStatus(d as never, 9, 1, 'weg', '')).rejects.toThrow(/Onbekende status/)
    await expect(setStatus(d as never, 9, 5, 'inactive', '')).rejects.toThrow(/organisatie/)
    await expect(setStatus(d as never, 9, 4, 'inactive', 'BEHEER@icares.nl')).rejects.toThrow(/beheerdersaccount/)
    expect(d.updates).toEqual([])
  })
})

describe('e-mail', () => {
  it('wijzigt alleen het e-mailadres', async () => {
    const d = db(people())
    expect(await setEmail(d as never, 9, 3, '  nieuw@org.nl ', '')).toEqual({ from: 'cli@org.nl', to: 'nieuw@org.nl' })
    expect(d.rows[2]).toEqual({ id: 3, role: 'client', status: 'active', email: 'nieuw@org.nl', organization_id: 9 })
  })

  it('weigert een ongeldig of dubbel adres', async () => {
    const d = db(people())
    await expect(setEmail(d as never, 9, 1, 'geen-adres', '')).rejects.toThrow(/geen geldig/)
    await expect(setEmail(d as never, 9, 1, 'MAN@org.nl', '')).rejects.toThrow(/al in gebruik.*user-id 2/)
    await expect(setEmail(d as never, 9, 5, 'x@y.nl', '')).rejects.toThrow(/organisatie/)
    await expect(setEmail(d as never, 9, 4, 'x@y.nl', 'beheer@icares.nl')).rejects.toThrow(/beheerdersaccount/)
    expect(d.updates).toEqual([])
  })
})
