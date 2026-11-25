import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { channel, type Api, type CopyField, type EditableEntry, type SettingsView } from '../shared/ipc'
import { SCRIPTS } from '../shared/scripts'
import type { Entry, EntryInput, EntrySummary, Result } from '../shared/types'
import { vaultPath } from './paths'
import { findScript, insideRoot, runScript, scriptFolder, scriptPath, toView } from './scripts/runner'
import { checkRequirement, installRequirement, LABELS, PC_REQUIREMENTS } from './scripts/requirements'
import * as db from './db/service'
import { toTsv, writeXlsx } from './db/query'
import { cancelLinkCheck, checkLinks } from './linkcheck'
import * as ipi from './ipi/service'
import * as people from './platform/service'
import * as administratie from './administratie'
import { audit, auditFile } from './audit'
import * as fontys from './fontys'
import { connect as dbConnect } from './ipi/db'
import type { FontysPlan, FontysSettings } from '../shared/fontys'
import { isEmail, type IpiConfig } from '../shared/ipi'
import { localDataDir } from './paths'
import { loadSettings, saveSettings } from './settings'
import { openVault, readVaultFile, VaultError, writeVaultFile, type VaultSession } from './vault/vault'
import { parseTotp, totpCode } from './vault/totp'
import { findQrPayloads, parseMigration, toOtpauthUri } from './vault/qr'

const here = path.dirname(fileURLToPath(import.meta.url))
const LOCK_AFTER_MS = 10 * 60 * 1000
const CLIPBOARD_CLEAR_S = 30

let win: BrowserWindow | null = null
let session: VaultSession | null = null
let lockTimer: NodeJS.Timeout | null = null
let failedLogins = 0
let fontysLast: { file: string; settings: FontysSettings; plan: FontysPlan } | null = null
let blockedUntil = 0

// ---------- sessie ----------
function touch(): void {
  if (lockTimer) clearTimeout(lockTimer)
  if (session) lockTimer = setTimeout(() => lock(), LOCK_AFTER_MS)
}

function lock(): void {
  session = null
  db.tunnel.close()
  cancelLinkCheck()
  people.resetPlatformSession()
  if (lockTimer) clearTimeout(lockTimer)
  win?.webContents.send('icares:locked')
}

function need(): VaultSession {
  if (!session) throw new VaultError('Je bent niet (meer) ingelogd.')
  touch()
  return session
}

function needSuper(): VaultSession {
  const s = need()
  if (!s.isSuperAdmin) throw new VaultError('Alleen de super admin mag dit.')
  return s
}

function summary(e: Entry): EntrySummary {
  return {
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    kind: e.kind,
    urls: e.urls,
    username: e.username,
    hasPassword: !!e.password,
    hasTotp: !!e.totp,
    hasPrivateKey: !!e.privateKey,
    notes: e.notes,
    extra: e.extra,
    updatedAt: e.updatedAt
  }
}

function settingsView(): SettingsView {
  const s = loadSettings()
  return { ...s, scriptsRootExists: fs.existsSync(s.scriptsRoot) }
}

let clipTimer: NodeJS.Timeout | null = null
let lastCopied = ''
async function copyTemporarily(text: string): Promise<number> {
  await clipboard.writeText(text)
  lastCopied = text
  if (clipTimer) clearTimeout(clipTimer)
  clipTimer = setTimeout(async () => {
    if ((await clipboard.readText()) === text) clipboard.clear()
  }, CLIPBOARD_CLEAR_S * 1000)
  return CLIPBOARD_CLEAR_S
}

function totpUri(e: Entry): string {
  if (!e.totp) return ''
  const t = e.totp
  const label = encodeURIComponent(t.label ?? e.title)
  const q = new URLSearchParams({ secret: t.secret, algorithm: t.algorithm, digits: String(t.digits), period: String(t.period) })
  if (t.issuer) q.set('issuer', t.issuer)
  return `otpauth://totp/${label}?${q.toString()}`
}

function openSafeUrl(url: string): void {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  const parsed = new URL(u)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Alleen webadressen kunnen geopend worden.')
  void shell.openExternal(parsed.toString())
}

// ---------- IPC ----------
type Handlers = { [K in keyof Api]?: (...args: Parameters<Api[K]>) => unknown }

/** Verpakt fouten als { ok:false, error } zodat het scherm een nette melding toont. */
function wrap<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ ok: true as const, value }))
    .catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
}

const handlers: Handlers = {
  login: (password) =>
    wrap(async () => {
      const now = Date.now()
      if (now < blockedUntil) throw new VaultError(`Te veel pogingen. Probeer het over ${Math.ceil((blockedUntil - now) / 1000)} seconden opnieuw.`)
      const file = readVaultFile(vaultPath())
      if (!file) throw new VaultError(`Geen kluis gevonden op ${vaultPath()}.`)
      try {
        session = openVault(file, password, (f) => writeVaultFile(vaultPath(), f))
      } catch (e) {
        failedLogins++
        if (failedLogins >= 5) blockedUntil = Date.now() + Math.min(300, 15 * 2 ** (failedLogins - 5)) * 1000
        throw e
      }
      failedLogins = 0
      touch()
      return session.info()
    }),
  logout: () => lock(),
  vaultExists: () => fs.existsSync(vaultPath()),
  importVault: () =>
    wrap(async () => {
      if (session) throw new Error('Vergrendel eerst het dashboard.')
      const r = await dialog.showOpenDialog(win!, {
        title: 'Kies het kluisbestand (vault.json of Icares-kluis_….json)',
        filters: [{ name: 'Kluis', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (r.canceled || !r.filePaths[0]) return false
      const file = readVaultFile(r.filePaths[0])
      if (!file || !Array.isArray(file.users) || file.users.length === 0) throw new Error('Dit is geen geldig kluisbestand.')
      const target = vaultPath()
      if (fs.existsSync(target)) {
        const current = readVaultFile(target)
        if (current && current.revision > file.revision) throw new Error(`De kluis op deze pc is nieuwer (versie ${current.revision}) dan het gekozen bestand (versie ${file.revision}).`)
      }
      writeVaultFile(target, file)
      return true
    }),
  exportVault: () =>
    wrap(async () => {
      needSuper()
      const stamp = new Date().toISOString().slice(0, 10)
      const r = await dialog.showSaveDialog(win!, {
        title: 'Kluis opslaan (bijv. op een USB-stick)',
        defaultPath: path.join(app.getPath('documents'), `Icares-kluis_${stamp}.json`),
        filters: [{ name: 'Kluis', extensions: ['json'] }]
      })
      if (r.canceled || !r.filePath) return null
      fs.copyFileSync(vaultPath(), r.filePath)
      return r.filePath
    }),
  session: () => session?.info() ?? null,
  changeOwnPassword: (cur, next) => wrap(() => need().changeOwnPassword(cur, next)),
  activity: () => touch(),

  listEntries: () => wrap(() => need().listEntries().map(summary)),
  reveal: (id) => wrap(() => need().getEntry(id).password ?? ''),
  copy: (id, field: CopyField) =>
    wrap(() => {
      const e = need().getEntry(id)
      const value = field === 'totp' ? (e.totp ? totpCode(e.totp).code : '') : (e[field] ?? '')
      if (!value) throw new Error('Dit veld is leeg.')
      return copyTemporarily(value)
    }),
  totpCodes: () =>
    wrap(() =>
      need()
        .listEntries()
        .filter((e) => e.totp)
        .map((e) => ({ entryId: e.id, period: e.totp!.period, ...totpCode(e.totp!) }))
    ),
  openUrl: (url) => wrap(() => openSafeUrl(url)),

  getEntry: (id) =>
    wrap((): EditableEntry => {
      const e = needSuper().getEntry(id)
      const { totp: _t, ...rest } = e
      return { ...rest, totpUri: totpUri(e) }
    }),
  saveEntry: (id, input: EntryInput) =>
    wrap(() => {
      const s = needSuper()
      const prev = id ? s.getEntry(id) : null
      let totp = prev?.totp
      if (input.totpUri !== undefined) totp = input.totpUri.trim() ? parseTotp(input.totpUri) : undefined
      if (!input.title.trim()) throw new Error('Geef het item een titel.')
      const saved = s.upsertEntry({
        id: id ?? undefined,
        groupId: input.groupId,
        title: input.title.trim(),
        kind: input.kind,
        urls: input.urls.map((u) => u.trim()).filter(Boolean),
        username: input.username?.trim() || undefined,
        password: input.password !== undefined ? input.password || undefined : prev?.password,
        notes: input.notes?.trim() || undefined,
        extra: input.extra?.trim() || undefined,
        totp,
        privateKey: prev?.privateKey
      })
      return summary(saved)
    }),
  deleteEntry: (id) => wrap(() => needSuper().deleteEntry(id)),
  addGroup: (name) => wrap(() => needSuper().addGroup(name)),
  renameGroup: (id, name) => wrap(() => needSuper().renameGroup(id, name)),
  deleteGroup: (id) => wrap(() => needSuper().deleteGroup(id)),
  allGroups: () => wrap(() => needSuper().info().groups),
  listUsers: () => wrap(() => needSuper().listUsers()),
  createUser: (name, role, pw, groups, scripts) => wrap(() => needSuper().createUser(name, role, pw, groups, scripts)),
  setAccess: (userId, groups, scripts) => wrap(() => needSuper().setAccess(userId, groups, scripts)),
  resetPassword: (userId, pw) => wrap(() => needSuper().resetPassword(userId, pw)),
  deleteUser: (userId) => wrap(() => needSuper().deleteUser(userId)),
  generatePassword: () => {
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const part = (): string => Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('')
    return `${part()}-${part()}-${part()}-${part()}`
  },

  totpFromImage: () =>
    wrap(async () => {
      needSuper()
      const r = await dialog.showOpenDialog(win!, {
        title: 'Kies een foto of screenshot van de 2FA-QR-code',
        filters: [{ name: 'Afbeelding', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
        properties: ['openFile']
      })
      if (r.canceled || !r.filePaths[0]) return null
      let img = nativeImage.createFromPath(r.filePaths[0])
      if (img.isEmpty()) throw new Error('Deze afbeelding kan niet gelezen worden.')
      const tryDecode = (im: Electron.NativeImage): string[] => {
        const { width, height } = im.getSize()
        const bgra = im.toBitmap()
        const rgba = new Uint8ClampedArray(bgra.length)
        for (let i = 0; i < bgra.length; i += 4) {
          rgba[i] = bgra[i + 2]
          rgba[i + 1] = bgra[i + 1]
          rgba[i + 2] = bgra[i]
          rgba[i + 3] = bgra[i + 3]
        }
        return findQrPayloads({ data: rgba, width, height })
      }
      let payloads = tryDecode(img)
      if (payloads.length === 0 && img.getSize().width > 1400) {
        img = img.resize({ width: 1200, quality: 'best' })
        payloads = tryDecode(img)
      }
      if (payloads.length === 0) throw new Error('Geen QR-code gevonden. Maak de foto scherper of dichterbij, of gebruik een screenshot.')
      const out: { label: string; issuer: string; uri: string }[] = []
      for (const p of payloads) {
        if (p.startsWith('otpauth-migration://')) {
          for (const o of parseMigration(p)) out.push({ label: o.name, issuer: o.issuer ?? '', uri: toOtpauthUri(o) })
        } else if (p.toLowerCase().startsWith('otpauth://')) {
          const c = parseTotp(p)
          out.push({ label: c.label ?? '', issuer: c.issuer ?? '', uri: toOtpauthUri(c) })
        }
      }
      if (out.length === 0) throw new Error('Er staat een QR-code op, maar dat is geen 2FA-code.')
      return out
    }),

  listScripts: () =>
    wrap(() => {
      const s = need()
      const settings = loadSettings()
      return SCRIPTS.filter((d) => s.canUseScript(d.id)).map((d) => toView(d, settings))
    }),
  allScripts: () => wrap(() => (needSuper(), SCRIPTS)),
  runScript: (id, args) =>
    wrap(() => {
      if (!need().canUseScript(id)) throw new Error('Je hebt geen toegang tot dit script.')
      runScript(findScript(id), args, loadSettings())
    }),
  openScriptFolder: (id) =>
    wrap(async () => {
      if (!need().canUseScript(id)) throw new Error('Geen toegang.')
      const dir = scriptFolder(findScript(id), loadSettings())
      const err = await shell.openPath(dir)
      if (err) throw new Error(`Map niet gevonden: ${dir}`)
    }),
  openScriptFile: (id) =>
    wrap(async () => {
      if (!need().canUseScript(id)) throw new Error('Geen toegang.')
      const err = await shell.openPath(scriptPath(findScript(id), loadSettings()))
      if (err) throw new Error(err)
    }),
  editScript: (id) =>
    wrap(() => {
      if (!need().canUseScript(id)) throw new Error('Geen toegang.')
      const p = scriptPath(findScript(id), loadSettings())
      if (!fs.existsSync(p)) throw new Error(`Script niet gevonden: ${p}`)
      // Kladblok opent elk tekstbestand; .pl en .sql hebben vaak geen standaardprogramma
      spawn('notepad.exe', [p], { detached: true, stdio: 'ignore' }).unref()
    }),
  copySql: (id) =>
    wrap(() => {
      if (!need().canUseScript(id)) throw new Error('Geen toegang.')
      const def = findScript(id)
      return copyTemporarily(fs.readFileSync(toView(def, loadSettings()).fullPath, 'utf8'))
    }),
  openDoc: (id, index) =>
    wrap(async () => {
      if (!need().canUseScript(id)) throw new Error('Geen toegang.')
      const settings = loadSettings()
      const doc = findScript(id).docs?.[index]
      if (!doc) throw new Error('Document niet gevonden.')
      const full = insideRoot(path.join(settings.scriptsRoot, doc.path), settings)
      const err = await shell.openPath(full)
      if (err) throw new Error(`Kan niet openen: ${full}`)
    }),
  pickFile: (scriptId, argId, save) =>
    wrap(async () => {
      if (!need().canUseScript(scriptId)) throw new Error('Geen toegang.')
      const def = findScript(scriptId)
      const arg = def.args?.find((a) => a.id === argId)
      const filters = arg?.extensions ? [{ name: arg.label, extensions: arg.extensions }] : []
      const defaultPath = scriptFolder(def, loadSettings())
      if (save) {
        const r = await dialog.showSaveDialog(win!, { defaultPath, filters })
        return r.canceled ? null : (r.filePath ?? null)
      }
      const r = await dialog.showOpenDialog(win!, { defaultPath, filters, properties: ['openFile'] })
      return r.canceled ? null : r.filePaths[0]
    }),

  tunnelState: () => db.tunnel.status(),
  tunnelOpen: () => wrap(() => db.openTunnel(need())),
  tunnelClose: () => db.tunnel.close(),
  runSql: (id) =>
    wrap(() => {
      if (!need().canUseScript(id)) throw new Error('Je hebt geen toegang tot dit script.')
      return db.runScriptSql(need(), id)
    }),
  exportResult: (name, result, format) =>
    wrap(async () => {
      need()
      const stamp = new Date().toISOString().slice(0, 10)
      const safe = name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'resultaat'
      const r = await dialog.showSaveDialog(win!, {
        defaultPath: path.join(app.getPath('documents'), `${safe}_${stamp}.${format}`),
        filters: format === 'xlsx' ? [{ name: 'Excel', extensions: ['xlsx'] }] : [{ name: 'Tab-gescheiden', extensions: ['tsv'] }]
      })
      if (r.canceled || !r.filePath) return null
      if (format === 'xlsx') await writeXlsx(r.filePath, name, result)
      else fs.writeFileSync(r.filePath, '﻿' + toTsv(result), 'utf8')
      return r.filePath
    }),
  copyResult: (result) =>
    wrap(async () => {
      need()
      await clipboard.writeText(toTsv(result, false))
    }),
  openPath: (p) =>
    wrap(async () => {
      need()
      if (!/\.(xlsx|tsv)$/i.test(p) || !fs.existsSync(p)) throw new Error('Bestand niet gevonden.')
      const err = await shell.openPath(p)
      if (err) throw new Error(err)
    }),
  dbConfig: () =>
    wrap(() => {
      const s = needSuper()
      const names = Object.fromEntries(s.info().groups.map((g) => [g.id, g.name]))
      return db.dbConfigView(s, (id) => names[id] ?? '')
    }),
  setDbConfig: (tunnelEntryId, dbEntryId) =>
    wrap(() => {
      const s = needSuper()
      s.setConfig({ tunnelEntryId: tunnelEntryId ?? undefined, dbEntryId: dbEntryId ?? undefined })
      db.tunnel.close()
    }),
  importSshKey: (entryId) =>
    wrap(async () => {
      const s = needSuper()
      const r = await dialog.showOpenDialog(win!, {
        title: 'Kies de privé SSH-sleutel (bijv. id_rsa, zonder .pub)',
        properties: ['openFile', 'showHiddenFiles']
      })
      if (r.canceled || !r.filePaths[0]) return false
      db.importKey(s, entryId, r.filePaths[0])
      return true
    }),
  testDb: () => wrap(() => db.testDb(need())),

  ipiPreview: () =>
    wrap(() => {
      if (!need().canUseScript('ipi-facturen')) throw new Error('Geen toegang tot IPI-facturatie.')
      return ipi.preview(need())
    }),
  ipiSamplePdf: (orgId) =>
    wrap(async () => {
      if (!need().canUseScript('ipi-facturen')) throw new Error('Geen toegang.')
      const f = await ipi.samplePdf(need(), Number(orgId))
      const err = await shell.openPath(f)
      if (err) throw new Error(err)
    }),
  ipiSend: (opts) =>
    wrap(() => {
      if (!need().canUseScript('ipi-facturen')) throw new Error('Geen toegang tot IPI-facturatie.')
      return ipi.send(need(), opts, (line) => {
        touch()
        win?.webContents.send('icares:ipiLog', line)
      })
    }),
  ipiResend: (runId) =>
    wrap(() => {
      if (!need().canUseScript('ipi-facturen')) throw new Error('Geen toegang.')
      return ipi.resend(String(runId), (line) => win?.webContents.send('icares:ipiLog', line))
    }),
  ipiOpenFile: (file) =>
    wrap(async () => {
      if (!need().canUseScript('ipi-facturen')) throw new Error('Geen toegang.')
      const full = path.resolve(String(file))
      const local = path.join(app.getPath('documents'), `IPI-facturen ${new Date().getFullYear()}`)
      const allowed = [ipi.invoiceFolder(), path.join(localDataDir(), 'ipi-test'), local].some((d) => full.startsWith(path.resolve(d) + path.sep) || full === path.resolve(d))
      if (!allowed || !fs.existsSync(full)) throw new Error('Bestand niet gevonden.')
      const err = await shell.openPath(full)
      if (err) throw new Error(err)
    }),
  ipiOpenInvoices: () =>
    wrap(() => {
      if (!need().canUseScript('ipi-betaald')) throw new Error('Geen toegang tot betaalde IPI-facturen.')
      return ipi.openInvoices(need())
    }),
  ipiMarkPaid: (userIds) =>
    wrap(() => {
      if (!need().canUseScript('ipi-betaald')) throw new Error('Geen toegang tot betaalde IPI-facturen.')
      if (!Array.isArray(userIds)) throw new Error('Ongeldige invoer.')
      return ipi.markPaid(need(), userIds.map(Number))
    }),
  ipiConfig: () =>
    wrap(() => {
      if (!need().canUseScript('ipi-facturen')) throw new Error('Geen toegang.')
      return ipi.ipiConfig(need())
    }),
  ipiSetConfig: (cfg: Partial<IpiConfig>) =>
    wrap(() => {
      const s = needSuper()
      const next = { ...ipi.ipiConfig(s), ...cfg }
      next.infoRecipients = next.infoRecipients.map((x) => x.trim()).filter(Boolean)
      if (next.infoRecipients.some((x) => !isEmail(x))) throw new Error('Een van de ter-info-adressen is ongeldig.')
      if (next.testAddress && !isEmail(next.testAddress)) throw new Error('Het testadres is ongeldig.')
      s.setConfig({ ipi: next })
      return next
    }),

  peopleSearchOrgs: (q) =>
    wrap(() => {
      if (!need().canUseScript('clienten-verwijderen')) throw new Error('Geen toegang tot personen verwijderen.')
      return people.searchOrgs(need(), String(q))
    }),
  peopleList: (orgId) =>
    wrap(() => {
      if (!need().canUseScript('clienten-verwijderen')) throw new Error('Geen toegang tot personen verwijderen.')
      return people.orgPeople(need(), Number(orgId))
    }),
  peopleDryRun: (userId) =>
    wrap(() => {
      if (!need().canUseScript('clienten-verwijderen')) throw new Error('Geen toegang tot personen verwijderen.')
      return people.dryRun(need(), Number(userId))
    }),
  peopleDelete: (orgId, userId) =>
    wrap(() => {
      if (!need().canUseScript('clienten-verwijderen')) throw new Error('Geen toegang tot personen verwijderen.')
      return people.deletePerson(need(), Number(orgId), Number(userId))
    }),

  peopleStatusOptions: () =>
    wrap(() => {
      if (!need().canUseScript('clienten-verwijderen')) throw new Error('Geen toegang.')
      return people.statusOptions(need())
    }),
  peopleSetStatus: (orgId, userId, status) =>
    wrap(() => {
      if (!need().canUseScript('clienten-verwijderen')) throw new Error('Geen toegang.')
      return people.setStatus(need(), Number(orgId), Number(userId), String(status))
    }),
  peopleSetEmail: (orgId, userId, email) =>
    wrap(() => {
      if (!need().canUseScript('clienten-verwijderen')) throw new Error('Geen toegang.')
      return people.setEmail(need(), Number(orgId), Number(userId), String(email))
    }),
  openAuditLog: () =>
    wrap(async () => {
      need()
      if (!fs.existsSync(auditFile())) throw new Error('Er zijn nog geen wijzigingen vastgelegd op deze pc.')
      const err = await shell.openPath(auditFile())
      if (err) throw new Error(err)
    }),

  fontysPickExcel: () =>
    wrap(async () => {
      if (!need().canUseScript('fontys-studenten')) throw new Error('Geen toegang.')
      const r = await dialog.showOpenDialog(win!, { title: 'Kies het Excel-bestand van Fontys', filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    }),
  fontysPlan: (file, settings) =>
    wrap(async () => {
      const s = need()
      if (!s.canUseScript('fontys-studenten')) throw new Error('Geen toegang.')
      const st: FontysSettings = {
        organizationId: Number(settings.organizationId),
        createdBy: Number(settings.createdBy),
        countryRegionId: Number(settings.countryRegionId),
        countryId: Number(settings.countryId),
        languageId: Number(settings.languageId)
      }
      if (Object.values(st).some((v) => !Number.isInteger(v) || v <= 0)) throw new Error('Vul bij de instellingen alleen hele getallen in.')
      if (!fs.existsSync(String(file))) throw new Error('Excel-bestand niet gevonden.')
      const rows = await fontys.readExcel(String(file))
      await db.ensureOpen(s)
      const conn = await dbConnect(db.tunnel, db.dbLogin(s))
      try {
        const plan = await fontys.plan(conn, rows, st, path.basename(String(file)))
        fontysLast = { file: String(file), settings: st, plan }
        return plan
      } finally {
        await conn.end().catch(() => conn.destroy())
      }
    }),
  fontysApply: () =>
    wrap(async () => {
      const s = need()
      if (!s.canUseScript('fontys-studenten')) throw new Error('Geen toegang.')
      if (!fontysLast) throw new Error('Controleer eerst het Excel-bestand.')
      const prev = fontysLast
      await db.ensureOpen(s)
      const conn = await dbConnect(db.tunnel, db.dbLogin(s))
      try {
        // Vlak voor het aanmaken opnieuw controleren: de database kan intussen veranderd zijn
        const fresh = await fontys.plan(conn, await fontys.readExcel(prev.file), prev.settings, prev.plan.file)
        const sig = (p: FontysPlan): string => p.rows.map((r) => `${r.email}:${r.action}`).join('|')
        if (sig(fresh) !== sig(prev.plan)) {
          fontysLast = { ...prev, plan: fresh }
          throw new Error('Sinds de controle is er iets veranderd (in het bestand of in de database). Bekijk het nieuwe overzicht en klik daarna opnieuw op "Accounts aanmaken".')
        }
        const r = await fontys.apply(conn, fresh, s.info().name)
        for (const row of fresh.rows.filter((x) => x.action === 'subadres')) audit(s.info().name, 'e-mail gewijzigd (Fontys-subadres)', row.existing!.id, `${row.email} -> ${row.existing!.newEmail}`)
        audit(s.info().name, 'Fontys-studenten aangemaakt', 0, `${r.created} professional(s) bij org ${fresh.settings.organizationId} uit ${fresh.file}`)
        fontysLast = null
        return r
      } finally {
        await conn.end().catch(() => conn.destroy())
      }
    }),
  fontysSaveSql: () =>
    wrap(async () => {
      const s = need()
      if (!s.canUseScript('fontys-studenten')) throw new Error('Geen toegang.')
      if (!fontysLast) throw new Error('Controleer eerst het Excel-bestand.')
      const stamp = new Date().toISOString().slice(0, 10)
      const r = await dialog.showSaveDialog(win!, {
        defaultPath: path.join(app.getPath('documents'), `insert_fontys_studenten_${stamp}.sql`),
        filters: [{ name: 'SQL', extensions: ['sql'] }]
      })
      if (r.canceled || !r.filePath) return null
      fs.writeFileSync(r.filePath, fontys.buildSql(fontysLast.plan, s.info().name), 'utf8')
      return r.filePath
    }),

  linkInstitutions: () =>
    wrap(() => {
      if (!need().canUseScript('linkchecker')) throw new Error('Geen toegang.')
      return db.linkInstitutions()
    }),
  linkUrlsFromDb: (id) =>
    wrap(() => {
      if (!need().canUseScript('linkchecker')) throw new Error('Geen toegang.')
      return db.linkUrlsFromDb(need(), id)
    }),
  linkUrlsFromFile: () =>
    wrap(async () => {
      if (!need().canUseScript('linkchecker')) throw new Error('Geen toegang.')
      const r = await dialog.showOpenDialog(win!, {
        defaultPath: path.join(loadSettings().scriptsRoot, 'Links_checken_gouden_onderwijs'),
        filters: [{ name: 'Tekst', extensions: ['txt'] }],
        properties: ['openFile']
      })
      if (r.canceled || !r.filePaths[0]) return null
      const urls = fs.readFileSync(r.filePaths[0], 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      return { file: r.filePaths[0], urls }
    }),
  linkCheck: (urls) =>
    wrap(() => {
      if (!need().canUseScript('linkchecker')) throw new Error('Geen toegang.')
      if (!Array.isArray(urls) || urls.length === 0) throw new Error('Geen links om te controleren.')
      if (urls.length > 5000) throw new Error('Maximaal 5000 links per keer.')
      return checkLinks(urls.map(String), (done, total) => {
        touch()
        win?.webContents.send('icares:linkProgress', done, total)
      })
    }),
  linkCancel: () => cancelLinkCheck(),

  adminStatus: () =>
    wrap(() => {
      if (!need().canUseScript('administratie')) throw new Error('Je hebt geen toegang tot de administratie.')
      return administratie.status(loadSettings().adminRoot)
    }),
  adminStart: () =>
    wrap(async () => {
      if (!need().canUseScript('administratie')) throw new Error('Je hebt geen toegang tot de administratie.')
      const s = need()
      const root = loadSettings().adminRoot
      // In de demo mag de WeFact-sleutel uit de kluis gebruikt worden om live te lezen (opslaan blijft geblokkeerd)
      const key = s.findConfigured(undefined, 'WeFact API')?.password
      await administratie.start(root, key)
      return administratie.status(root)
    }),
  adminInstall: () =>
    wrap(() => {
      if (!need().canUseScript('administratie')) throw new Error('Je hebt geen toegang tot de administratie.')
      administratie.install(loadSettings().adminRoot)
    }),

  adminMakeDemo: () =>
    wrap(async () => {
      needSuper()
      const r = await dialog.showOpenDialog(win!, { title: 'Waar moet het demopakket komen? (bijv. je USB-stick)', properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      const dest = await administratie.makeDemoPackage(loadSettings().adminRoot, r.filePaths[0], (line) => {
        touch()
        win?.webContents.send('icares:adminProgress', line)
      })
      audit(need().info().name, 'demopakket administratie gemaakt', 0, dest)
      return dest
    }),
  adminOpenDemo: () =>
    wrap(async () => {
      if (!need().canUseScript('administratie')) throw new Error('Je hebt geen toegang tot de administratie.')
      const r = await dialog.showOpenDialog(win!, { title: 'Kies de map "Icares-administratie-demo_…"', properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return false
      await administratie.openDemoPackage(r.filePaths[0])
      return true
    }),
  adminRemoveDemo: () =>
    wrap(() => {
      if (!need().canUseScript('administratie')) throw new Error('Geen toegang.')
      administratie.removeDemo()
    }),

  checkRequirements: async (ids) => {
    const s = need()
    const list = ids?.length ? ids : PC_REQUIREMENTS
    return Promise.all(
      list.map(async (id) => {
        if (id !== 'tunnel') return checkRequirement(id)
        const p = db.problems(s)
        return { id, ...LABELS.tunnel, ok: p.length === 0, detail: p.length ? p.join(' ') : 'Klaar voor gebruik.' }
      })
    )
  },
  installRequirement: (id) =>
    wrap(async () => {
      need()
      await installRequirement(id)
    }),
  getSettings: () => settingsView(),
  saveSettings: (s) =>
    wrap(() => {
      need()
      saveSettings(s)
      return settingsView()
    }),
  pickFolder: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  }
}

db.onTunnelChange((s) => win?.webContents.send('icares:tunnel', s))

for (const [name, fn] of Object.entries(handlers)) {
  if (name === 'activity') {
    ipcMain.on(channel('activity'), () => touch())
    continue
  }
  ipcMain.handle(channel(name as keyof Api), (event, ...args: unknown[]) => {
    // Alleen ons eigen venster mag de kluis aanspreken
    if (!win || event.sender !== win.webContents) throw new Error('Onbekende afzender.')
    return (fn as (...a: unknown[]) => unknown)(...args)
  })
}

// ---------- venster ----------
function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Icares Dashboard',
    backgroundColor: '#F6F5FF',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  // Geen nieuwe vensters of navigatie naar buiten; links gaan naar de browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(here, '../renderer/index.html'))
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(createWindow)
  app.on('will-quit', () => administratie.stopDemo())
  app.on('window-all-closed', async () => {
    administratie.stopDemo() // de demo-administratie stopt mee; de echte blijft draaien zoals altijd
    try {
      if (lastCopied && (await clipboard.readText()) === lastCopied) clipboard.clear()
    } finally {
      app.quit()
    }
  })
}
