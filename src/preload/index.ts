// Brug tussen scherm en hoofdproces: alleen de methodes uit het Api-contract.
import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/ipc'

const METHODS: (keyof Api)[] = [
  'login', 'logout', 'session', 'changeOwnPassword', 'vaultExists', 'importVault', 'exportVault',
  'listEntries', 'reveal', 'copy', 'totpCodes', 'openUrl',
  'getEntry', 'saveEntry', 'deleteEntry', 'addGroup', 'renameGroup', 'deleteGroup', 'allGroups',
  'listUsers', 'createUser', 'setAccess', 'resetPassword', 'deleteUser', 'generatePassword', 'totpFromImage',
  'listScripts', 'allScripts', 'runScript', 'openScriptFolder', 'openScriptFile', 'editScript', 'copySql', 'openDoc', 'pickFile',
  'tunnelState', 'tunnelOpen', 'tunnelClose', 'runSql', 'exportResult', 'copyResult', 'openPath',
  'dbConfig', 'setDbConfig', 'importSshKey', 'testDb',
  'ipiPreview', 'ipiSamplePdf', 'ipiSend', 'ipiResend', 'ipiOpenFile', 'ipiConfig', 'ipiSetConfig', 'ipiOpenInvoices', 'ipiMarkPaid',
  'peopleSearchOrgs', 'peopleList', 'peopleDryRun', 'peopleDelete', 'peopleStatusOptions', 'peopleSetStatus', 'peopleSetEmail', 'openAuditLog',
  'fontysPickExcel', 'fontysPlan', 'fontysApply', 'fontysSaveSql',
  'linkInstitutions', 'linkUrlsFromDb', 'linkUrlsFromFile', 'linkCheck', 'linkCancel',
  'adminStatus', 'adminStart', 'adminInstall', 'adminMakeDemo', 'adminOpenDemo', 'adminRemoveDemo',
  'checkRequirements', 'installRequirement', 'getSettings', 'saveSettings', 'pickFolder'
]

const api: Record<string, unknown> = {}
for (const m of METHODS) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`icares:${m}`, ...args)
api.activity = () => ipcRenderer.send('icares:activity')
api.onLocked = (cb: () => void) => {
  const listener = (): void => cb()
  ipcRenderer.on('icares:locked', listener)
  return () => ipcRenderer.removeListener('icares:locked', listener)
}

api.onTunnel = (cb: (s: unknown) => void) => {
  const listener = (_e: unknown, s: unknown): void => cb(s)
  ipcRenderer.on('icares:tunnel', listener)
  return () => ipcRenderer.removeListener('icares:tunnel', listener)
}
api.onLinkProgress = (cb: (done: number, total: number) => void) => {
  const listener = (_e: unknown, done: number, total: number): void => cb(done, total)
  ipcRenderer.on('icares:linkProgress', listener)
  return () => ipcRenderer.removeListener('icares:linkProgress', listener)
}

api.onIpiLog = (cb: (line: string) => void) => {
  const listener = (_e: unknown, line: string): void => cb(line)
  ipcRenderer.on('icares:ipiLog', listener)
  return () => ipcRenderer.removeListener('icares:ipiLog', listener)
}

api.onAdminProgress = (cb: (line: string) => void) => {
  const listener = (_e: unknown, line: string): void => cb(line)
  ipcRenderer.on('icares:adminProgress', listener)
  return () => ipcRenderer.removeListener('icares:adminProgress', listener)
}

contextBridge.exposeInMainWorld('icares', api as unknown as Api)
