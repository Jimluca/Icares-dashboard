// Scripts starten, mappen openen en de database-tunnel.
import fs from 'node:fs'
import path from 'node:path'
import { SCRIPTS, type ScriptDef } from '../../shared/scripts'
import type { ScriptView } from '../../shared/ipc'
import type { Settings } from '../settings'
import { cmdQuote, openConsole } from './console'
import { strawberryPerl } from './requirements'
import { scriptFile } from '../bundled'

export function findScript(id: string): ScriptDef {
  const s = SCRIPTS.find((x) => x.id === id)
  if (!s) throw new Error('Onbekend script.')
  return s
}

export function scriptFolder(def: ScriptDef, settings: Settings): string {
  return path.join(settings.scriptsRoot, def.folder)
}

export function scriptPath(def: ScriptDef, settings: Settings): string {
  return path.join(scriptFolder(def, settings), def.file)
}

export function allRequires(def: ScriptDef): string[] {
  const r = new Set(def.requires)
  if (def.perlModules?.length) r.add('perl-modules')
  if (def.needsTunnel || def.kind === 'sql') r.add('tunnel')
  return [...r]
}

export function toView(def: ScriptDef, settings: Settings): ScriptView {
  // Ingebouwde scripts (SQL en dashboardonderdelen) kunnen terugvallen op een kopie in het programma
  if (def.kind === 'sql' || def.kind === 'builtin') {
    const f = scriptFile(path.join(def.folder, def.file))
    return { ...def, allRequires: allRequires(def), exists: f.exists || def.kind === 'builtin', fullPath: f.path, bundled: f.bundled }
  }
  const full = scriptPath(def, settings)
  return { ...def, allRequires: allRequires(def), exists: fs.existsSync(full), fullPath: full }
}

/** Een pad moet binnen de scriptmap blijven (geen ..\..\ trucs via de catalogus of documenten). */
export function insideRoot(p: string, settings: Settings): string {
  const root = path.resolve(settings.scriptsRoot)
  const full = path.resolve(p)
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Pad valt buiten de scriptmap.')
  return full
}

function argValue(def: ScriptDef, args: Record<string, string>): string[] {
  const out: string[] = []
  for (const a of def.args ?? []) {
    const v = (args[a.id] ?? '').trim()
    if (!v) {
      if (!a.optional) throw new Error(`Vul "${a.label}" in.`)
      // optionele argumenten zijn positioneel: na een lege stoppen we
      break
    }
    if (a.type === 'number' && !/^\d{1,6}$/.test(v)) throw new Error(`"${a.label}" moet een getal zijn.`)
    if (a.type === 'file' && !a.save && !fs.existsSync(v)) throw new Error(`Bestand niet gevonden: ${v}`)
    out.push(v)
  }
  return out
}

export function runScript(def: ScriptDef, args: Record<string, string>, settings: Settings): void {
  if (def.kind === 'sql' || def.kind === 'builtin') throw new Error('Dit script draait in het dashboard zelf.')
  const folder = scriptFolder(def, settings)
  const file = scriptPath(def, settings)
  if (!fs.existsSync(file)) throw new Error(`Script niet gevonden: ${file}`)
  const values = argValue(def, args).map(cmdQuote).join(' ')
  let line: string
  const pre: string[] = []
  switch (def.kind) {
    case 'perl': {
      const perl = strawberryPerl()
      if (!perl) throw new Error('Strawberry Perl is niet geïnstalleerd. Zie "Deze pc".')
      const bin = path.dirname(perl)
      pre.push(`set "PATH=${bin};${path.join(bin, '..', '..', 'c', 'bin')};%PATH%"`)
      line = `${cmdQuote(perl)} ${cmdQuote(def.file)} ${values}`
      break
    }
    case 'python':
      throw new Error('Python-scripts worden niet meer los gestart.')
    case 'powershell':
      line = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${cmdQuote(def.file)} ${values}`
      break
  }
  openConsole({
    title: def.title,
    cwd: folder,
    lines: [...pre, `echo Script: ${def.file.replace(/[&|<>^%]/g, '')}`, 'echo.', line.trim()]
  })
}
