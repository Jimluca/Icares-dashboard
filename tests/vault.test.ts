import { describe, expect, it } from 'vitest'
import { createVault, openVault, type VaultFile } from '../src/main/vault/vault'
import { base32Encode, parseTotp, totpCode } from '../src/main/vault/totp'

const SA_PW = 'super-admin-test-ww-123'
const ADMIN_PW = 'admin-test-wachtwoord-1'

function sample(): VaultFile {
  const now = new Date().toISOString()
  return createVault('Super Admin', SA_PW, [
    { name: 'Mail', entries: [{ id: 'm1', title: 'Webmail', kind: 'login', urls: [], username: 'a', password: 'geheim-mail', updatedAt: now }] },
    { name: 'AWS', entries: [{ id: 'a1', title: 'AWS root', kind: 'login', urls: [], username: 'b', password: 'geheim-aws', updatedAt: now }] }
  ])
}

const noSave = (): void => {}

describe('kluis', () => {
  it('opent met het juiste wachtwoord en weigert een fout wachtwoord', () => {
    const file = sample()
    const s = openVault(file, SA_PW, noSave)
    expect(s.info().role).toBe('superadmin')
    expect(s.listEntries()).toHaveLength(2)
    expect(() => openVault(file, 'fout-wachtwoord-xyz', noSave)).toThrow('Onjuist wachtwoord')
  })

  it('bevat geen leesbare wachtwoorden in het bestand', () => {
    const json = JSON.stringify(sample())
    expect(json).not.toContain('geheim-mail')
    expect(json).not.toContain('geheim-aws')
  })

  it('geeft een admin alleen de toegewezen groepen', () => {
    let saved: VaultFile | null = null
    const file = sample()
    const sa = openVault(file, SA_PW, (f) => (saved = structuredClone(f)))
    const mail = sa.info().groups.find((g) => g.name === 'Mail')!
    const aws = sa.info().groups.find((g) => g.name === 'AWS')!
    sa.createUser('Collega', 'admin', ADMIN_PW, [mail.id], ['ipi-facturen'])

    const admin = openVault(saved!, ADMIN_PW, noSave)
    expect(admin.info().role).toBe('admin')
    expect(admin.info().groups.map((g) => g.name)).toEqual(['Mail'])
    expect(admin.listEntries().map((e) => e.title)).toEqual(['Webmail'])
    expect(() => admin.getEntry('a1')).toThrow()
    expect(admin.canUseScript('ipi-facturen')).toBe(true)
    expect(admin.canUseScript('clienten-verwijderen')).toBe(false)

    // Ook met de privésleutel kan de admin de AWS-groep niet openen: er is geen sleutel voor.
    const rec = saved!.users.find((u) => u.name === 'Collega')!
    expect(rec.groupKeys[aws.id]).toBeUndefined()
  })

  it('kan rechten intrekken en een admin mag niets beheren', () => {
    let saved: VaultFile = sample()
    const sa = openVault(saved, SA_PW, (f) => (saved = structuredClone(f)))
    const ids = sa.info().groups.map((g) => g.id)
    const u = sa.createUser('Collega', 'admin', ADMIN_PW, ids, [])
    sa.setAccess(u.id, [ids[1]], [])
    const admin = openVault(saved, ADMIN_PW, noSave)
    expect(admin.listEntries().map((e) => e.title)).toEqual(['AWS root'])
    expect(() => admin.deleteEntry('a1')).toThrow('Alleen de super admin')
    expect(() => admin.listUsers()).toThrow()
  })

  it('weigert een wachtwoord dat al in gebruik is', () => {
    const sa = openVault(sample(), SA_PW, noSave)
    expect(() => sa.createUser('X', 'admin', SA_PW, [], [])).toThrow('al in gebruik')
  })

  it('reset van wachtwoord door super admin behoudt toegang', () => {
    let saved: VaultFile = sample()
    const sa = openVault(saved, SA_PW, (f) => (saved = structuredClone(f)))
    const mail = sa.info().groups[0]
    const u = sa.createUser('Collega', 'admin', ADMIN_PW, [mail.id], [])
    sa.resetPassword(u.id, 'nieuw-admin-ww-4567')
    expect(() => openVault(saved, ADMIN_PW, noSave)).toThrow()
    expect(openVault(saved, 'nieuw-admin-ww-4567', noSave).listEntries()).toHaveLength(1)
  })

  it('bewaart wijzigingen en nieuwe groepen zijn zichtbaar na opnieuw openen', () => {
    let saved: VaultFile = sample()
    const sa = openVault(saved, SA_PW, (f) => (saved = structuredClone(f)))
    const g = sa.addGroup('API-sleutels')
    sa.upsertEntry({ groupId: g.id, title: 'Sleutel', kind: 'note', urls: [], notes: 'abc' })
    sa.changeOwnPassword(SA_PW, 'ander-super-ww-9876')
    const again = openVault(saved, 'ander-super-ww-9876', noSave)
    expect(again.listEntries().map((e) => e.title)).toContain('Sleutel')
    expect(saved.revision).toBeGreaterThan(1)
  })

  it('detecteert geknoei met versleutelde data', () => {
    const file = sample()
    const gid = file.groups[0].id
    const ct = Buffer.from(file.data[gid].ct, 'base64')
    ct[0] ^= 1
    file.data[gid].ct = ct.toString('base64')
    expect(() => openVault(file, SA_PW, noSave)).toThrow()
  })
})

describe('2FA', () => {
  it('geeft de RFC 6238-testcode', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    const cfg = { secret, algorithm: 'SHA1' as const, digits: 8, period: 30 }
    expect(totpCode(cfg, 59_000).code).toBe('94287082')
    expect(totpCode(cfg, 1_111_111_109_000).code).toBe('07081804')
  })

  it('leest een otpauth-link', () => {
    const c = parseTotp('otpauth://totp/AWS:robert?secret=JBSWY3DPEHPK3PXP&issuer=AWS')
    expect(c.issuer).toBe('AWS')
    expect(c.digits).toBe(6)
  })
})
