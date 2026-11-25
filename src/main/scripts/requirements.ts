// Controleert of deze pc alles heeft voor de scripts die (nog) los draaien,
// en kan ontbrekende onderdelen installeren (in een zichtbaar terminalvenster).
// De SQL-scripts, de tunnel en de linkchecker zitten in het dashboard zelf
// en hebben niets extra's nodig.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { SCRIPTS } from '../../shared/scripts'
import type { RequirementStatus } from '../../shared/ipc'
import { cmdQuote, openConsole } from './console'

function run(file: string, args: string[], timeout = 20000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })
    })
  })
}

export function strawberryPerl(): string | null {
  for (const p of ['C:\\Strawberry\\perl\\bin\\perl.exe', 'C:\\Strawberry64\\perl\\bin\\perl.exe']) {
    if (fs.existsSync(p)) return p
  }
  return null
}

async function hasComClass(progId: string): Promise<boolean> {
  return (await run('reg.exe', ['query', `HKCR\\${progId}\\CLSID`])).ok
}

/** Alle Perl-modules die de scripts nodig hebben. */
export function allPerlModules(): string[] {
  return [...new Set(SCRIPTS.flatMap((s) => s.perlModules ?? []))].sort()
}

export async function missingPerlModules(modules: string[]): Promise<string[] | null> {
  const perl = strawberryPerl()
  if (!perl) return null
  const code = 'for my $m (@ARGV) { eval "require $m; 1" or print "$m\\n" }'
  const r = await run(perl, ['-e', code, ...modules], 60000)
  return r.out.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[A-Za-z0-9:_]+$/.test(s))
}

export const LABELS: Record<string, { label: string; help: string }> = {
  tunnel: { label: 'Database-koppeling', help: 'SSH-sleutel en databasewachtwoord in de kluis. Zit in het dashboard; niets te installeren.' },
  perl: { label: 'Strawberry Perl', help: 'Alleen nodig voor de Perl-scripts die nog niet in het dashboard zijn ingebouwd.' },
  'perl-modules': { label: 'Perl-modules', help: 'Extra onderdelen die die Perl-scripts gebruiken (DBI, Excel, e-mail, enz.).' },
  excel: { label: 'Microsoft Excel', help: 'De IPI- en rapportagescripts sturen Excel aan.' },
  word: { label: 'Microsoft Word', help: 'De IPI- en rapportagescripts sturen Word aan.' }
}

/** Onderdelen die op de pagina "Deze pc" staan (de database-koppeling staat daar apart). */
export const PC_REQUIREMENTS = ['perl', 'perl-modules', 'excel', 'word']

export async function checkRequirement(id: string): Promise<RequirementStatus> {
  const meta = LABELS[id] ?? { label: id, help: '' }
  const base = { id, label: meta.label, help: meta.help }
  switch (id) {
    case 'perl': {
      const p = strawberryPerl()
      if (!p) return { ...base, ok: false, detail: 'Niet gevonden in C:\\Strawberry.', canInstall: true }
      const v = await run(p, ['-e', 'print $^V'])
      return { ...base, ok: true, detail: `Perl ${v.out}` }
    }
    case 'perl-modules': {
      const missing = await missingPerlModules(allPerlModules())
      if (missing === null) return { ...base, ok: false, detail: 'Installeer eerst Strawberry Perl.' }
      return missing.length === 0
        ? { ...base, ok: true, detail: `Alle ${allPerlModules().length} modules aanwezig.` }
        : { ...base, ok: false, detail: `Ontbreekt: ${missing.join(', ')}`, canInstall: true }
    }
    case 'excel': {
      const ok = await hasComClass('Excel.Application')
      return { ...base, ok, detail: ok ? 'Geïnstalleerd' : 'Niet gevonden (Microsoft 365 desktop-app nodig).' }
    }
    case 'word': {
      const ok = await hasComClass('Word.Application')
      return { ...base, ok, detail: ok ? 'Geïnstalleerd' : 'Niet gevonden (Microsoft 365 desktop-app nodig).' }
    }
    default:
      return { ...base, ok: false, detail: 'Onbekend onderdeel.' }
  }
}

/** Opent een terminalvenster dat het onderdeel installeert. */
export async function installRequirement(id: string): Promise<void> {
  switch (id) {
    case 'perl':
      return openConsole({
        title: 'Strawberry Perl installeren',
        lines: [
          'echo Installeren via winget: StrawberryPerl.StrawberryPerl',
          'winget install -e --id StrawberryPerl.StrawberryPerl --accept-package-agreements',
          'echo Herstart daarna het dashboard.'
        ]
      })
    case 'perl-modules': {
      const missing = (await missingPerlModules(allPerlModules())) ?? []
      const perlBin = path.dirname(strawberryPerl() ?? 'C:\\Strawberry\\perl\\bin\\perl.exe')
      return openConsole({
        title: 'Perl-modules installeren',
        lines: [
          `set "PATH=${perlBin};${path.join(perlBin, '..', '..', 'c', 'bin')};%PATH%"`,
          `echo Ontbrekende modules: ${missing.join(' ')}`,
          'echo Dit kan een paar minuten duren.',
          `call ${cmdQuote(path.join(perlBin, 'cpanm.bat'))} --notest ${missing.join(' ')}`
        ]
      })
    }
    default:
      throw new Error('Dit onderdeel kan niet automatisch geïnstalleerd worden.')
  }
}
