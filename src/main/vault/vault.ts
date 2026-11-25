// De kluis: één JSON-bestand met versleutelde groepen en gebruikers.
//
// Opbouw:
// - Elke groep heeft een eigen willekeurige sleutel; de items van die groep
//   staan versleuteld met die sleutel in `data[groupId]`.
// - Elke gebruiker heeft een X25519-sleutelpaar. De privésleutel staat
//   versleuteld met een sleutel die uit het wachtwoord komt (scrypt).
// - Per gebruiker staan de groepssleutels waar die bij mag "verzegeld" met
//   de publieke sleutel van die gebruiker. Een admin zonder sleutel van een
//   groep kan die groep dus echt niet openen.
import fs from 'node:fs'
import path from 'node:path'
import type { Entry, Group, Role, SessionInfo, UserSummary, VaultConfig } from '../../shared/types'
import {
  type EncBlob,
  type KdfParams,
  type SealedBox,
  decrypt,
  decryptJson,
  deriveKey,
  encrypt,
  encryptJson,
  exportPrivateKey,
  importPrivateKey,
  newKdfParams,
  newKeyPair,
  randomId,
  randomKey,
  seal,
  unseal
} from './crypto'
import type crypto from 'node:crypto'

export interface UserRecord {
  id: string
  name: string
  role: Role
  kdf: KdfParams
  publicKey: string
  privateKeyEnc: EncBlob
  groupKeys: Record<string, SealedBox>
  scriptIds: string[]
  createdAt: string
}

export interface VaultFile {
  format: 1
  revision: number
  updatedAt: string
  groups: Group[]
  users: UserRecord[]
  data: Record<string, EncBlob>
  /** Niet-geheime instellingen die voor iedereen gelden. */
  config?: VaultConfig
}

const aadPriv = (userId: string): string => `user-private|${userId}`
const aadGroupKey = (groupId: string, userId: string): string => `group-key|${groupId}|${userId}`
const aadGroupData = (groupId: string): string => `group-data|${groupId}`

export class VaultError extends Error {}

interface OpenUser {
  record: UserRecord
  privateKey: crypto.KeyObject
}

/** Een geopende kluis voor één ingelogde gebruiker. */
export class VaultSession {
  private readonly groupKeys = new Map<string, Buffer>()
  private readonly entries = new Map<string, Entry[]>()

  constructor(
    private file: VaultFile,
    private readonly user: OpenUser,
    private readonly save: (file: VaultFile) => void
  ) {
    for (const [groupId, box] of Object.entries(user.record.groupKeys)) {
      if (!file.data[groupId]) continue
      const key = unseal(user.privateKey, user.record.publicKey, box, aadGroupKey(groupId, user.record.id))
      this.groupKeys.set(groupId, key)
      this.entries.set(groupId, decryptJson<Entry[]>(key, file.data[groupId], aadGroupData(groupId)))
    }
  }

  get isSuperAdmin(): boolean {
    return this.user.record.role === 'superadmin'
  }

  info(): SessionInfo {
    const r = this.user.record
    return {
      userId: r.id,
      name: r.name,
      role: r.role,
      groups: this.file.groups.filter((g) => this.groupKeys.has(g.id)),
      scriptIds: r.role === 'superadmin' ? ['*'] : [...r.scriptIds]
    }
  }

  canUseScript(scriptId: string): boolean {
    return this.isSuperAdmin || this.user.record.scriptIds.includes(scriptId)
  }

  listEntries(): Entry[] {
    return [...this.entries.values()].flat()
  }

  getEntry(id: string): Entry {
    for (const list of this.entries.values()) {
      const e = list.find((x) => x.id === id)
      if (e) return e
    }
    throw new VaultError('Item niet gevonden of geen toegang.')
  }

  getConfig(): VaultConfig {
    return { ...(this.file.config ?? {}) }
  }

  /** Zoekt een item op id, of anders op het begin van de titel. Null als je er geen toegang toe hebt. */
  findConfigured(id: string | undefined, titlePrefix: string): Entry | null {
    const all = this.listEntries()
    return (id && all.find((e) => e.id === id)) || all.find((e) => e.title.startsWith(titlePrefix)) || null
  }

  // ---------- Beheer (alleen super admin) ----------

  setConfig(config: VaultConfig): void {
    this.requireSuperAdmin()
    this.file.config = { ...(this.file.config ?? {}), ...config }
    this.commit()
  }

  setPrivateKey(entryId: string, privateKey: string | undefined): Entry {
    this.requireSuperAdmin()
    const e = this.getEntry(entryId)
    return this.upsertEntry({ ...e, privateKey })
  }

  private requireSuperAdmin(): void {
    if (!this.isSuperAdmin) throw new VaultError('Alleen de super admin mag dit.')
  }

  private persistGroup(groupId: string): void {
    const key = this.groupKeys.get(groupId)
    if (!key) throw new VaultError('Geen toegang tot deze groep.')
    this.file.data[groupId] = encryptJson(key, this.entries.get(groupId) ?? [], aadGroupData(groupId))
  }

  private commit(): void {
    this.file.revision += 1
    this.file.updatedAt = new Date().toISOString()
    this.save(this.file)
  }

  upsertEntry(entry: Omit<Entry, 'id' | 'updatedAt'> & { id?: string }): Entry {
    this.requireSuperAdmin()
    if (!this.groupKeys.has(entry.groupId)) throw new VaultError('Onbekende groep.')
    const now = new Date().toISOString()
    let oldGroup: string | undefined
    if (entry.id) {
      for (const [gid, list] of this.entries) {
        if (list.some((x) => x.id === entry.id)) oldGroup = gid
      }
    }
    const full: Entry = { ...entry, id: entry.id ?? randomId(), updatedAt: now } as Entry
    if (oldGroup) {
      this.entries.set(oldGroup, this.entries.get(oldGroup)!.filter((x) => x.id !== full.id))
      this.persistGroup(oldGroup)
    }
    this.entries.set(entry.groupId, [...(this.entries.get(entry.groupId) ?? []), full])
    this.persistGroup(entry.groupId)
    this.commit()
    return full
  }

  deleteEntry(id: string): void {
    this.requireSuperAdmin()
    for (const [gid, list] of this.entries) {
      if (list.some((x) => x.id === id)) {
        this.entries.set(gid, list.filter((x) => x.id !== id))
        this.persistGroup(gid)
        this.commit()
        return
      }
    }
    throw new VaultError('Item niet gevonden.')
  }

  addGroup(name: string): Group {
    this.requireSuperAdmin()
    const group: Group = { id: randomId(), name: name.trim() }
    if (!group.name) throw new VaultError('Geef de groep een naam.')
    const key = randomKey()
    this.groupKeys.set(group.id, key)
    this.entries.set(group.id, [])
    this.file.groups.push(group)
    for (const u of this.file.users) {
      if (u.role === 'superadmin') u.groupKeys[group.id] = seal(u.publicKey, key, aadGroupKey(group.id, u.id))
    }
    this.persistGroup(group.id)
    this.commit()
    return group
  }

  renameGroup(groupId: string, name: string): void {
    this.requireSuperAdmin()
    const g = this.file.groups.find((x) => x.id === groupId)
    if (!g || !name.trim()) throw new VaultError('Ongeldige groep of naam.')
    g.name = name.trim()
    this.commit()
  }

  deleteGroup(groupId: string): void {
    this.requireSuperAdmin()
    if ((this.entries.get(groupId) ?? []).length > 0) {
      throw new VaultError('Deze groep bevat nog items. Verplaats of verwijder die eerst.')
    }
    this.file.groups = this.file.groups.filter((g) => g.id !== groupId)
    delete this.file.data[groupId]
    for (const u of this.file.users) delete u.groupKeys[groupId]
    this.groupKeys.delete(groupId)
    this.entries.delete(groupId)
    this.commit()
  }

  listUsers(): UserSummary[] {
    this.requireSuperAdmin()
    return this.file.users.map(toSummary)
  }

  createUser(name: string, role: Role, password: string, groupIds: string[], scriptIds: string[]): UserSummary {
    this.requireSuperAdmin()
    assertPasswordStrength(password)
    if (!name.trim()) throw new VaultError('Geef de gebruiker een naam.')
    if (findUserByPassword(this.file, password)) {
      throw new VaultError('Dit wachtwoord is al in gebruik. Inloggen gaat alleen met een wachtwoord, dus elk wachtwoord moet uniek zijn.')
    }
    const record = buildUser(name.trim(), role, password)
    this.file.users.push(record)
    this.applyAccess(record, role === 'superadmin' ? this.file.groups.map((g) => g.id) : groupIds, scriptIds)
    this.commit()
    return toSummary(record)
  }

  setAccess(userId: string, groupIds: string[], scriptIds: string[]): void {
    this.requireSuperAdmin()
    const u = this.file.users.find((x) => x.id === userId)
    if (!u) throw new VaultError('Gebruiker niet gevonden.')
    if (u.role === 'superadmin') throw new VaultError('Een super admin kan altijd overal bij.')
    this.applyAccess(u, groupIds, scriptIds)
    this.commit()
  }

  private applyAccess(u: UserRecord, groupIds: string[], scriptIds: string[]): void {
    const wanted = new Set(groupIds.filter((id) => this.groupKeys.has(id)))
    for (const gid of Object.keys(u.groupKeys)) if (!wanted.has(gid)) delete u.groupKeys[gid]
    for (const gid of wanted) {
      if (!u.groupKeys[gid]) u.groupKeys[gid] = seal(u.publicKey, this.groupKeys.get(gid)!, aadGroupKey(gid, u.id))
    }
    u.scriptIds = u.role === 'superadmin' ? [] : [...new Set(scriptIds)]
  }

  deleteUser(userId: string): void {
    this.requireSuperAdmin()
    if (userId === this.user.record.id) throw new VaultError('Je kunt jezelf niet verwijderen.')
    const u = this.file.users.find((x) => x.id === userId)
    if (!u) throw new VaultError('Gebruiker niet gevonden.')
    this.file.users = this.file.users.filter((x) => x.id !== userId)
    this.commit()
  }

  /** Super admin zet een nieuw wachtwoord voor iemand (bijv. bij het uitdelen). */
  resetPassword(userId: string, newPassword: string): void {
    this.requireSuperAdmin()
    const u = this.file.users.find((x) => x.id === userId)
    if (!u) throw new VaultError('Gebruiker niet gevonden.')
    if (u.id === this.user.record.id) throw new VaultError('Wijzig je eigen wachtwoord via "Mijn wachtwoord".')
    assertPasswordStrength(newPassword)
    const other = findUserByPassword(this.file, newPassword)
    if (other && other.id !== userId) throw new VaultError('Dit wachtwoord is al in gebruik.')
    // De super admin kent de privésleutel van de ander niet, dus die krijgt een nieuw
    // sleutelpaar en de groepssleutels worden opnieuw verzegeld.
    const groupIds = Object.keys(u.groupKeys)
    const fresh = buildUser(u.name, u.role, newPassword, u.id, u.createdAt)
    fresh.scriptIds = u.scriptIds
    Object.assign(u, fresh)
    this.applyAccess(u, u.role === 'superadmin' ? this.file.groups.map((g) => g.id) : groupIds, u.scriptIds)
    this.commit()
  }

  changeOwnPassword(current: string, next: string): void {
    const r = this.user.record
    try {
      decrypt(deriveKey(current, r.kdf), r.privateKeyEnc, aadPriv(r.id))
    } catch {
      throw new VaultError('Je huidige wachtwoord klopt niet.')
    }
    assertPasswordStrength(next)
    const other = findUserByPassword(this.file, next)
    if (other && other.id !== r.id) throw new VaultError('Dit wachtwoord is al in gebruik.')
    r.kdf = newKdfParams()
    r.privateKeyEnc = encrypt(deriveKey(next, r.kdf), exportPrivateKey(this.user.privateKey), aadPriv(r.id))
    this.commit()
  }
}

function toSummary(u: UserRecord): UserSummary {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    groupIds: Object.keys(u.groupKeys),
    scriptIds: u.role === 'superadmin' ? ['*'] : u.scriptIds,
    createdAt: u.createdAt
  }
}

export function assertPasswordStrength(pw: string): void {
  if (pw.length < 12) throw new VaultError('Een wachtwoord moet minstens 12 tekens lang zijn.')
}

function buildUser(name: string, role: Role, password: string, id = randomId(), createdAt = new Date().toISOString()): UserRecord {
  const kp = newKeyPair()
  const kdf = newKdfParams()
  return {
    id,
    name,
    role,
    kdf,
    publicKey: kp.publicKey,
    privateKeyEnc: encrypt(deriveKey(password, kdf), exportPrivateKey(kp.privateKey), aadPriv(id)),
    groupKeys: {},
    scriptIds: [],
    createdAt
  }
}

function tryOpen(u: UserRecord, password: string): crypto.KeyObject | null {
  try {
    return importPrivateKey(decrypt(deriveKey(password, u.kdf), u.privateKeyEnc, aadPriv(u.id)))
  } catch {
    return null
  }
}

function findUserByPassword(file: VaultFile, password: string): UserRecord | null {
  for (const u of file.users) if (tryOpen(u, password)) return u
  return null
}

/** Maakt een nieuwe kluis met één super admin en de opgegeven groepen. */
export function createVault(
  superAdminName: string,
  password: string,
  groups: { name: string; entries: Omit<Entry, 'groupId'>[] }[]
): VaultFile {
  assertPasswordStrength(password)
  const admin = buildUser(superAdminName, 'superadmin', password)
  const file: VaultFile = {
    format: 1,
    revision: 1,
    updatedAt: new Date().toISOString(),
    groups: [],
    users: [admin],
    data: {}
  }
  for (const g of groups) {
    const group: Group = { id: randomId(), name: g.name }
    const key = randomKey()
    file.groups.push(group)
    const entries: Entry[] = g.entries.map((e) => ({ ...e, groupId: group.id }))
    file.data[group.id] = encryptJson(key, entries, aadGroupData(group.id))
    admin.groupKeys[group.id] = seal(admin.publicKey, key, aadGroupKey(group.id, admin.id))
  }
  return file
}

export function openVault(file: VaultFile, password: string, save: (f: VaultFile) => void): VaultSession {
  for (const u of file.users) {
    const pk = tryOpen(u, password)
    if (pk) return new VaultSession(file, { record: u, privateKey: pk }, save)
  }
  throw new VaultError('Onjuist wachtwoord.')
}

// ---------- Bestand lezen en schrijven ----------

export function readVaultFile(p: string): VaultFile | null {
  if (!fs.existsSync(p)) return null
  const file = JSON.parse(fs.readFileSync(p, 'utf8')) as VaultFile
  if (file.format !== 1) throw new VaultError('Onbekend kluisformaat.')
  return file
}

/** Schrijft veilig: eerst naar een tijdelijk bestand, oude versie blijft als .bak bewaard. */
export function writeVaultFile(p: string, file: VaultFile): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(file, null, 1), 'utf8')
  if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak`)
  fs.renameSync(tmp, p)
}
