// Koppeling met de administratie-app (WeFact-automatisering, Python/Flask).
// - "echt": de gedeelde map "Wefact automatisering" staat op deze pc (poort 47815)
// - "demo": een demopakket is geopend (poort 47816); WeFact alleen lezen/afspelen, niets opslaan
// De Python en pakketten zitten in het programma; de gegevens niet (die komen uit de map of het demopakket).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import type { AdminAppStatus } from '../shared/ipc'
import { resourcesDir } from './bundled'
import { localDataDir } from './paths'
import { cmdQuote, openConsole } from './scripts/console'

export const REAL_PORT = 47815
export const DEMO_PORT = 47816
let demoPid: number | null = null

/** Mogelijke plekken van de gedeelde map "Wefact automatisering". */
export function defaultAdminRoot(): string {
  const home = os.homedir()
  const candidates = [
    path.join(home, 'OneDrive - Icares B.V', 'Bureaublad', 'Wefact automatisering'),
    path.join(home, 'OneDrive - Icares B.V', 'Desktop', 'Wefact automatisering'),
    path.join(home, 'Icares B.V', 'Wefact automatisering')
  ]
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]
}

export function demoDir(): string {
  return path.join(localDataDir(), 'administratie-demo')
}

const hasApp = (root: string): boolean => fs.existsSync(path.join(root, 'overzicht', 'overzicht', 'dashboard'))

function bundledPythonDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'python') : path.join(resourcesDir(), '..', 'build', 'python')
}

/** Python die bij installeren.bat is vastgelegd (op Jims pc), anders de ingebouwde. */
function python(gui: boolean): string {
  const f = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'icares-overzicht', 'pythonw.txt')
  if (fs.existsSync(f)) {
    const w = fs.readFileSync(f, 'utf8').split(/\r?\n/)[0].trim()
    const p = gui ? w : path.join(path.dirname(w), 'python.exe')
    if (w && fs.existsSync(p)) return p
  }
  const b = path.join(bundledPythonDir(), gui ? 'pythonw.exe' : 'python.exe')
  if (fs.existsSync(b)) return b
  throw new Error('Python voor de administratie ontbreekt in deze installatie.')
}

const launcher = (name: string): string => path.join(resourcesDir(), 'administratie', name)

async function ping(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Welke administratie draaien we op deze pc? */
function mode(root: string): { mode: 'echt' | 'demo' | 'geen'; dir: string; port: number } {
  if (process.env.ICARES_ADMIN_FORCE_DEMO !== '1' && hasApp(root)) return { mode: 'echt', dir: root, port: REAL_PORT }
  if (hasApp(demoDir())) return { mode: 'demo', dir: demoDir(), port: DEMO_PORT }
  return { mode: 'geen', dir: '', port: DEMO_PORT }
}

export async function status(root: string): Promise<AdminAppStatus> {
  const m = mode(root)
  const snapshot = m.dir ? readJson<{ tijdstip?: string }>(path.join(m.dir, 'laatste-resultaat.json'))?.tijdstip ?? '' : ''
  const recorded = m.mode === 'demo' ? readJson<{ vastgelegd?: string }>(path.join(m.dir, 'demo-wefact.json'))?.vastgelegd ?? '' : ''
  return {
    url: `http://127.0.0.1:${m.port}`,
    root,
    mode: m.mode,
    folderExists: m.mode !== 'geen',
    installed: true,
    running: m.mode !== 'geen' && (await ping(m.port)),
    snapshot,
    recorded,
    canMakeDemo: hasApp(root)
  }
}

export async function start(root: string, wefactKey?: string): Promise<void> {
  const m = mode(root)
  if (m.mode === 'geen') throw new Error('Er staat geen administratie op deze pc. Open een demopakket of stel de map in bij "Deze pc".')
  if (await ping(m.port)) return
  const child = spawn(python(true), [launcher('icares_start.py')], {
    cwd: path.join(m.dir, 'overzicht'),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ICARES_ADMIN_ROOT: m.dir,
      ICARES_ADMIN_PORT: String(m.port),
      ICARES_ADMIN_DEMO: m.mode === 'demo' ? '1' : '0',
      ...(m.mode === 'demo' && wefactKey ? { ICARES_WEFACT_API: wefactKey } : {})
    }
  })
  child.unref()
  if (m.mode === 'demo') demoPid = child.pid ?? null
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await ping(m.port)) return
  }
  throw new Error(`De administratie start niet. Kijk in ${path.join(m.dir, 'overzicht', 'logs')} (dashboard-….log).`)
}

export function install(root: string): void {
  const bat = path.join(root, 'installeren.bat')
  if (!fs.existsSync(bat)) throw new Error(`installeren.bat niet gevonden in ${root}.`)
  openConsole({ title: 'Administratie installeren', cwd: root, keepOpen: false, lines: [`call ${cmdQuote(bat)}`] })
}

// ---------- demopakket ----------

const DATA_FILES = /^(laatste-resultaat\.json|instellingen\.json|Administratie-overzicht-\d{4}\.xlsx|BVKostenBaten\d{4}\.xlsx)$/i
const DATA_DIRS = ['invoer', 'inkoop']

function copyCode(from: string, to: string): void {
  fs.cpSync(path.join(from, 'overzicht', 'overzicht'), path.join(to, 'overzicht', 'overzicht'), {
    recursive: true,
    filter: (src) => !/__pycache__|\.pytest_cache/.test(src)
  })
  fs.mkdirSync(path.join(to, 'overzicht', 'logs'), { recursive: true })
}

/** Maakt een demopakket in `destParent` met een WeFact-vastlegging en een kopie van de gegevens. */
export async function makeDemoPackage(root: string, destParent: string, progress: (s: string) => void): Promise<string> {
  if (!hasApp(root)) throw new Error('Een demopakket maken kan alleen op een pc waar de echte administratie staat.')
  const dest = path.join(destParent, `Icares-administratie-demo_${new Date().toISOString().slice(0, 10)}`)
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })

  progress('Gegevens uit WeFact vastleggen (alleen lezen)…')
  await new Promise<void>((resolve, reject) => {
    const p = spawn(python(false), [launcher('icares_vastleggen.py'), path.join(root, 'overzicht'), path.join(dest, 'demo-wefact.json')], {
      cwd: path.join(root, 'overzicht'),
      windowsHide: true
    })
    let err = ''
    p.stdout.on('data', (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (line.startsWith('STAP cijfers')) progress('Cijfers en facturen vastgelegd. Leveranciers ophalen…')
        if (line.startsWith('STAP inkoop')) progress(`Leveranciers vastgelegd (${line.split(' ')[2]}). Boekingsregels ophalen…`)
        if (line.startsWith('STAP boekingsregels')) progress('Boekingsregels vastgelegd.')
      }
    })
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    const t = setTimeout(() => p.kill(), 15 * 60 * 1000)
    p.on('close', (code) => {
      clearTimeout(t)
      if (code === 0) resolve()
      else reject(new Error(`Vastleggen uit WeFact mislukt: ${err.trim().split(/\r?\n/).pop() ?? 'onbekende fout'}`))
    })
  })

  progress('App en gegevens kopiëren…')
  copyCode(root, dest)
  for (const f of fs.readdirSync(root)) if (DATA_FILES.test(f)) fs.copyFileSync(path.join(root, f), path.join(dest, f))
  for (const d of DATA_DIRS) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(dest, d), { recursive: true })
  const cache = path.join(process.env.LOCALAPPDATA ?? '', 'icares-overzicht', 'cache')
  if (fs.existsSync(cache)) fs.cpSync(cache, path.join(dest, 'cache'), { recursive: true })
  fs.writeFileSync(
    path.join(dest, 'LEESMIJ.txt'),
    'Demopakket van de Icares-administratie.\r\nBevat financiële gegevens (BVKostenBaten, bankexports, WeFact-gegevens): behandel het als vertrouwelijk en verwijder het na de demo.\r\nOpenen: Icares Dashboard > Administratie > Demopakket openen… en kies deze map.\r\n',
    'utf8'
  )
  progress('Klaar.')
  return dest
}

/** Zet een demopakket op deze pc klaar (kopie in de eigen gegevensmap van het dashboard). */
export function stopDemo(): void {
  if (demoPid) {
    try {
      process.kill(demoPid)
    } catch {
      /* al gestopt */
    }
    demoPid = null
  }
}

export async function openDemoPackage(src: string): Promise<void> {
  stopDemo()
  await new Promise((r) => setTimeout(r, 800))
  if (await ping(DEMO_PORT)) throw new Error('Er draait nog een demo-administratie. Sluit het dashboard helemaal af, start het opnieuw en probeer het nog eens.')
  if (!hasApp(src) || !fs.existsSync(path.join(src, 'demo-wefact.json'))) {
    throw new Error('Dit is geen demopakket. Kies de map "Icares-administratie-demo_…".')
  }
  const dest = demoDir()
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
}

export function removeDemo(): void {
  stopDemo()
  fs.rmSync(demoDir(), { recursive: true, force: true })
}
