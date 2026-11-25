// Het contract tussen schermen (renderer) en hoofdproces.
import type { IpiConfig, IpiPreview, IpiSendOptions, IpiSendResult, MarkPaidResult, OpenInvoice } from './ipi'
import type { DeleteOutcome, OrgPerson, OrgSearchHit } from './people'
import type { FontysPlan, FontysResult, FontysSettings } from './fontys'
import type { ScriptDef } from './scripts'
import type {
  Entry,
  EntryInput,
  EntrySummary,
  Group,
  Result,
  Role,
  SessionInfo,
  TotpCode,
  UserSummary
} from './types'

export interface RequirementStatus {
  id: string
  label: string
  help: string
  ok: boolean
  detail: string
  canInstall?: boolean
}

export interface ScriptView extends ScriptDef {
  allRequires: string[]
  exists: boolean
  fullPath: string
  /** Ingebouwde kopie gebruikt omdat de SharePoint-map ontbreekt. */
  bundled?: boolean
}

export interface SettingsView {
  scriptsRoot: string
  scriptsRootExists: boolean
  adminRoot: string
  tunnel: { host: string; user: string; localPort: number; remotePort: number; database: string }
}

export interface AdminAppStatus {
  url: string
  root: string
  mode: 'echt' | 'demo' | 'geen'
  folderExists: boolean
  installed: boolean
  running: boolean
  /** Tijdstip van de momentopname die de app toont. */
  snapshot: string
  /** Wanneer de WeFact-gegevens van de demo zijn vastgelegd. */
  recorded: string
  /** De echte administratie staat op deze pc, dus een demopakket maken kan. */
  canMakeDemo: boolean
}

export interface TunnelState {
  open: boolean
  connecting: boolean
  localPort?: number
  localListening: boolean
  error?: string
  since?: string
}

export interface QueryResult {
  columns: string[]
  rows: (string | number | null)[][]
  truncated: boolean
  ms: number
}

export interface LinkResult {
  url: string
  status: string
  finalUrl: string
  redirects: string
  error: string
  ok: boolean
}

export interface Institution {
  id: number
  name: string
}

export interface DbConfigView {
  tunnelEntryId: string | null
  dbEntryId: string | null
  candidates: { id: string; title: string; hasPrivateKey: boolean; groupName: string }[]
  /** Waarom de koppeling (nog) niet werkt; leeg als alles klaarstaat. */
  problems: string[]
}

export type CopyField = 'username' | 'password' | 'totp' | 'notes' | 'extra'

export interface EditableEntry extends Omit<Entry, 'totp'> {
  totpUri: string
}

export interface Api {
  // inloggen
  login(password: string): Promise<Result<SessionInfo>>
  logout(): Promise<void>
  session(): Promise<SessionInfo | null>
  vaultExists(): Promise<boolean>
  importVault(): Promise<Result<boolean>>
  exportVault(): Promise<Result<string | null>>
  changeOwnPassword(current: string, next: string): Promise<Result>
  activity(): void
  onLocked(cb: () => void): () => void

  // kluis
  listEntries(): Promise<Result<EntrySummary[]>>
  reveal(id: string): Promise<Result<string>>
  copy(id: string, field: CopyField): Promise<Result<number>> // seconden tot klembord leeg
  totpCodes(): Promise<Result<TotpCode[]>>
  openUrl(url: string): Promise<Result>

  // beheer (super admin)
  getEntry(id: string): Promise<Result<EditableEntry>>
  saveEntry(id: string | null, input: EntryInput): Promise<Result<EntrySummary>>
  deleteEntry(id: string): Promise<Result>
  addGroup(name: string): Promise<Result<Group>>
  renameGroup(id: string, name: string): Promise<Result>
  deleteGroup(id: string): Promise<Result>
  allGroups(): Promise<Result<Group[]>>
  listUsers(): Promise<Result<UserSummary[]>>
  createUser(name: string, role: Role, password: string, groupIds: string[], scriptIds: string[]): Promise<Result<UserSummary>>
  setAccess(userId: string, groupIds: string[], scriptIds: string[]): Promise<Result>
  resetPassword(userId: string, password: string): Promise<Result>
  deleteUser(userId: string): Promise<Result>
  generatePassword(): Promise<string>
  totpFromImage(): Promise<Result<{ label: string; issuer: string; uri: string }[] | null>>

  // scripts
  listScripts(): Promise<Result<ScriptView[]>>
  allScripts(): Promise<Result<ScriptDef[]>>
  runScript(id: string, args: Record<string, string>): Promise<Result>
  openScriptFolder(id: string): Promise<Result>
  openScriptFile(id: string): Promise<Result>
  editScript(id: string): Promise<Result>
  copySql(id: string): Promise<Result<number>>
  openDoc(id: string, index: number): Promise<Result>
  pickFile(scriptId: string, argId: string, save: boolean): Promise<Result<string | null>>

  // database en tunnel
  tunnelState(): Promise<TunnelState>
  tunnelOpen(): Promise<Result>
  tunnelClose(): Promise<void>
  onTunnel(cb: (s: TunnelState) => void): () => void
  runSql(scriptId: string): Promise<Result<QueryResult>>
  exportResult(name: string, result: QueryResult, format: 'xlsx' | 'tsv'): Promise<Result<string | null>>
  copyResult(result: QueryResult): Promise<Result>
  openPath(path: string): Promise<Result>
  dbConfig(): Promise<Result<DbConfigView>>
  setDbConfig(tunnelEntryId: string | null, dbEntryId: string | null): Promise<Result>
  importSshKey(entryId: string): Promise<Result<boolean>>
  testDb(): Promise<Result<string>>

  // IPI-facturatie
  ipiPreview(): Promise<Result<IpiPreview>>
  ipiSamplePdf(orgId: number): Promise<Result>
  ipiSend(opts: IpiSendOptions): Promise<Result<IpiSendResult>>
  ipiResend(runId: string): Promise<Result>
  ipiOpenFile(file: string): Promise<Result>
  ipiConfig(): Promise<Result<IpiConfig>>
  ipiSetConfig(cfg: Partial<IpiConfig>): Promise<Result<IpiConfig>>
  onIpiLog(cb: (line: string) => void): () => void
  ipiOpenInvoices(): Promise<Result<OpenInvoice[]>>
  ipiMarkPaid(userIds: number[]): Promise<Result<MarkPaidResult>>

  // personen verwijderen
  peopleSearchOrgs(q: string): Promise<Result<OrgSearchHit[]>>
  peopleList(orgId: number): Promise<Result<OrgPerson[]>>
  peopleDryRun(userId: number): Promise<Result<string>>
  peopleDelete(orgId: number, userId: number): Promise<Result<DeleteOutcome>>
  peopleStatusOptions(): Promise<Result<string[]>>
  peopleSetStatus(orgId: number, userId: number, status: string): Promise<Result<string>>
  peopleSetEmail(orgId: number, userId: number, email: string): Promise<Result<string>>
  openAuditLog(): Promise<Result>

  // Fontys-studenten
  fontysPickExcel(): Promise<Result<string | null>>
  fontysPlan(file: string, settings: FontysSettings): Promise<Result<FontysPlan>>
  fontysApply(): Promise<Result<FontysResult>>
  fontysSaveSql(): Promise<Result<string | null>>

  // linkchecker
  linkInstitutions(): Promise<Result<Institution[]>>
  linkUrlsFromDb(institutionId: number): Promise<Result<QueryResult>>
  linkUrlsFromFile(): Promise<Result<{ file: string; urls: string[] } | null>>
  linkCheck(urls: string[]): Promise<Result<LinkResult[]>>
  linkCancel(): Promise<void>
  onLinkProgress(cb: (done: number, total: number) => void): () => void

  // administratie
  adminStatus(): Promise<Result<AdminAppStatus>>
  adminStart(): Promise<Result<AdminAppStatus>>
  adminInstall(): Promise<Result>
  adminMakeDemo(): Promise<Result<string | null>>
  adminOpenDemo(): Promise<Result<boolean>>
  adminRemoveDemo(): Promise<Result>
  onAdminProgress(cb: (line: string) => void): () => void

  // pc
  checkRequirements(ids?: string[]): Promise<RequirementStatus[]>
  installRequirement(id: string): Promise<Result>
  getSettings(): Promise<SettingsView>
  saveSettings(s: SettingsView): Promise<Result<SettingsView>>
  pickFolder(): Promise<string | null>
}

/** Namen van de IPC-kanalen: 'icares:<methode>'. */
export const channel = (name: keyof Api): string => `icares:${name}`
