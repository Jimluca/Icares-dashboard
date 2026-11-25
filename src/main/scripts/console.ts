// Opent een zichtbaar terminalvenster (cmd) met een reeks commando's.
// We schrijven een tijdelijk .cmd-bestand: dat is betrouwbaarder dan
// alles in één opdrachtregel te quoten.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { localDataDir } from '../paths'

/** Zet een waarde tussen aanhalingstekens voor gebruik in een .cmd-bestand. */
export function cmdQuote(value: string): string {
  if (/["\r\n]/.test(value)) throw new Error('Ongeldig teken (" of regeleinde) in invoer.')
  return `"${value.replace(/%/g, '%%')}"`
}

export interface ConsoleOptions {
  title: string
  cwd?: string
  lines: string[] // regels voor het .cmd-bestand
  keepOpen?: boolean
  env?: Record<string, string>
}

export function openConsole(opts: ConsoleOptions): void {
  const dir = path.join(localDataDir(), 'run')
  fs.mkdirSync(dir, { recursive: true })
  // oude runbestanden opruimen
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(p)
    } catch {
      /* negeren */
    }
  }
  const file = path.join(dir, `run-${Date.now()}.cmd`)
  const safeTitle = opts.title.replace(/[&|<>^%"]/g, '')
  const body = [
    '@echo off',
    'chcp 65001 >nul',
    `title Icares Dashboard - ${safeTitle}`,
    ...(opts.cwd ? [`cd /d ${cmdQuote(opts.cwd)}`] : []),
    ...opts.lines,
    ...(opts.keepOpen === false
      ? []
      : ['echo.', 'echo ------------------------------------------------------------', 'echo Klaar. Je kunt dit venster sluiten.', 'pause >nul'])
  ].join('\r\n')
  fs.writeFileSync(file, body, 'utf8')
  const child = spawn('cmd.exe', ['/c', 'start', '""', `"${file}"`], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
    env: { ...process.env, ...(opts.env ?? {}) }
  })
  child.unref()
}
