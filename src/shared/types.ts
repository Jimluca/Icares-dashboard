// Types die zowel het hoofdproces als de schermen gebruiken.

export type Role = 'superadmin' | 'admin'

export interface Group {
  id: string
  name: string
}

export interface TotpConfig {
  secret: string // base32
  issuer?: string
  label?: string
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  digits: number
  period: number
}

export interface Entry {
  id: string
  groupId: string
  title: string
  kind: 'login' | 'note'
  urls: string[]
  username?: string
  password?: string
  notes?: string
  extra?: string
  totp?: TotpConfig
  /** Privé SSH-sleutel (PEM/OpenSSH-tekst). Wordt nooit naar het scherm gestuurd. */
  privateKey?: string
  updatedAt: string
}

/** Wat het scherm van een item ziet: geen wachtwoord en geen 2FA-sleutel. */
export interface EntrySummary {
  id: string
  groupId: string
  title: string
  kind: 'login' | 'note'
  urls: string[]
  username?: string
  hasPassword: boolean
  hasTotp: boolean
  hasPrivateKey: boolean
  notes?: string
  extra?: string
  updatedAt: string
}

/** Invoer bij aanmaken of wijzigen. Velden die ontbreken blijven zoals ze waren. */
export interface EntryInput {
  groupId: string
  title: string
  kind: 'login' | 'note'
  urls: string[]
  username?: string
  password?: string
  notes?: string
  extra?: string
  totpUri?: string // otpauth://... of een kale base32-sleutel; '' = verwijderen
}

export interface UserSummary {
  id: string
  name: string
  role: Role
  groupIds: string[]
  scriptIds: string[]
  createdAt: string
}

export interface SessionInfo {
  userId: string
  name: string
  role: Role
  groups: Group[] // groepen waar deze gebruiker bij kan
  scriptIds: string[] // '*' = alle scripts
}

export interface TotpCode {
  entryId: string
  code: string
  secondsLeft: number
  period: number
}

/** Welke kluisitems het dashboard gebruikt voor de database-koppeling. */
export interface VaultConfig {
  tunnelEntryId?: string // item met SSH-sleutel + passphrase (wachtwoordveld)
  dbEntryId?: string // item met databasegebruiker + wachtwoord
  ipi?: Partial<import('./ipi').IpiConfig>
  platformEntryId?: string // beheerdersaccount Icares Professional (verwijderen)
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }
