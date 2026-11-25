// Linkchecker met de ingebouwde browser (Chromium) van het dashboard.
// Zelfde werkwijze als Roberts linkcheck_playwright.py: pagina openen,
// even wachten op JavaScript-redirects, en status + eindadres vastleggen.
import { BrowserWindow, session } from 'electron'
import type { LinkResult } from '../shared/ipc'

const TIMEOUT_MS = 60_000
const WAIT_AFTER_LOAD_MS = 1_200
const CONCURRENCY = 6
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

let running: { cancelled: boolean } | null = null

let prepared: Electron.Session | null = null
function checkSession(): Electron.Session {
  if (prepared) return prepared
  const s = session.fromPartition('linkcheck') // niet-persistent: geen cookies bewaard
  s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  s.on('will-download', (e) => e.preventDefault())
  s.setUserAgent(USER_AGENT, 'nl-NL,nl;q=0.9')
  prepared = s
  return s
}

async function checkOne(url: string, ses: Electron.Session): Promise<LinkResult> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, images: false }
  })
  const wc = win.webContents
  wc.setAudioMuted(true)
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  const redirects: string[] = []
  let status: number | null = null
  wc.on('did-redirect-navigation', (_e, u, _inPlace, isMainFrame) => {
    if (isMainFrame) redirects.push(u)
  })
  wc.on('did-navigate', (_e, _u, code) => {
    if (code > 0) status = code
  })
  const base = { url, redirects: '' }
  try {
    if (!/^https?:\/\//i.test(url)) return { ...base, status: 'ONGELDIG', finalUrl: '', error: 'Geen http(s)-adres', ok: false }
    await Promise.race([
      wc.loadURL(url),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('TIMEOUT')), TIMEOUT_MS))
    ])
    await new Promise((r) => setTimeout(r, WAIT_AFTER_LOAD_MS))
    const code = status as number | null
    return {
      url,
      status: code ? String(code) : 'ONBEKEND',
      finalUrl: wc.getURL(),
      redirects: redirects.join(' > '),
      error: '',
      ok: code !== null && code < 400
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // loadURL faalt ook bij een 4xx/5xx-pagina zonder inhoud; dan hebben we de status wel
    const code = status as number | null
    if (code && !/TIMEOUT/.test(msg)) {
      return { url, status: String(code), finalUrl: wc.getURL(), redirects: redirects.join(' > '), error: '', ok: code < 400 }
    }
    return {
      url,
      status: /TIMEOUT/.test(msg) ? 'TIMEOUT' : 'FOUT',
      finalUrl: wc.isDestroyed() ? '' : wc.getURL(),
      redirects: redirects.join(' > '),
      error: /TIMEOUT/.test(msg) ? `Geen antwoord binnen ${TIMEOUT_MS / 1000} s` : msg.replace(/^Error: /, ''),
      ok: false
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function checkLinks(urls: string[], onProgress: (done: number, total: number, last: LinkResult) => void): Promise<LinkResult[]> {
  if (running) throw new Error('Er loopt al een linkcheck.')
  const job = { cancelled: false }
  running = job
  const ses = checkSession()
  const list = [...new Set(urls.map((u) => u.trim()).filter((u) => u && !u.startsWith('#')))]
  const results: LinkResult[] = new Array(list.length)
  let next = 0
  let done = 0
  const worker = async (): Promise<void> => {
    while (!job.cancelled && next < list.length) {
      const i = next++
      results[i] = await checkOne(list[i], ses)
      done++
      onProgress(done, list.length, results[i])
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))
  } finally {
    running = null
    await ses.clearStorageData().catch(() => {})
  }
  return results.filter(Boolean)
}

export function cancelLinkCheck(): void {
  if (running) running.cancelled = true
}
