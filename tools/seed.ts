// Vult een nieuwe kluis met de overdracht van Robert.
//
// Gebruik:  npx tsx tools/seed.ts "<map met overdracht>" "<scriptmap>" [--force]
//
// - Leest Icares1PasswordExport_onbeveiligd.xlsx (inlogs + secure notes)
// - Leest de Google Authenticator-export(s) en koppelt 2FA-codes aan items
// - Zet een tijdelijke super admin en een test-admin klaar; de wachtwoorden
//   komen in dev-credentials.local.txt (staat in .gitignore)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { createVault, openVault, writeVaultFile } from '../src/main/vault/vault'
import { vaultPath } from '../src/main/paths'
import type { Entry, TotpConfig } from '../src/shared/types'
import { findQrPayloads, parseMigration, type MigratedOtp } from './qr-migration'

const [, , handoverDir, scriptsDir, ...flags] = process.argv
if (!handoverDir) {
  console.error('Gebruik: npx tsx tools/seed.ts "<map met overdracht>" "<scriptmap>" [--force]')
  process.exit(1)
}
const target = vaultPath()
if (fs.existsSync(target) && !flags.includes('--force')) {
  console.error(`Er staat al een kluis op ${target}. Gebruik --force om die te vervangen (er blijft een .bak).`)
  process.exit(1)
}

// ---------- Groepen ----------
const GROUPS = {
  mail: 'Mail & Combell',
  quest: 'AWS & Quest',
  servers: 'Servers & databases',
  api: 'API-sleutels',
  it: 'Microsoft, Google & IT',
  other: 'Overige diensten'
} as const
type GroupKey = keyof typeof GROUPS

function groupFor(title: string, isNote: boolean): GroupKey {
  const t = title.toLowerCase()
  if (isNote) return /quest/.test(t) ? 'quest' : 'api'
  if (/iam login|amazon|quest|superadmin staging/.test(t)) return 'quest'
  if (/phpmyadmin|ssh |vps|mysql/.test(t)) return 'servers'
  if (/competentnl|api/.test(t)) return 'api'
  if (/microsoft|google|administrator windows|myzyxel|github/.test(t)) return 'it'
  if (/@icares|combell|webmail|mailbox|bounces|invoices mail/.test(t)) return 'mail'
  return 'other'
}

// 2FA uit de export koppelen aan bestaande items (titel uit de Excel)
const TOTP_MATCH: { issuer: string; name: string; title: string }[] = [
  { issuer: 'Atlassian', name: 'robert@icares.nl', title: 'Jira login 3bird' },
  { issuer: 'Combell bv', name: 'support@icares.nl', title: 'Combell Control Panel support@icares.nl' },
  { issuer: 'Combell bv', name: 'robert@icares.nl', title: 'Combell Control Panel Robert' },
  { issuer: 'myZyxel', name: 'robert@icares.nl', title: 'myZyxel' },
  { issuer: 'Amazon Web Services', name: 'Authapp@255638996431', title: 'Amazon Icares BV' },
  { issuer: 'Amazon Web Services', name: 'robert_iam_admin@255638996431', title: 'IAM login' },
  { issuer: 'Google', name: 'icares.nederland@gmail.com', title: 'Google' }
]

const now = new Date().toISOString()
const cell = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('')
  if (typeof v === 'object' && 'text' in v) return String(v.text)
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '')
  return String(v)
}

async function readExcel(file: string): Promise<{ entry: Omit<Entry, 'groupId'>; group: GroupKey }[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const out: { entry: Omit<Entry, 'groupId'>; group: GroupKey }[] = []
  wb.eachSheet((ws) => {
    const isNote = /secure/i.test(ws.name)
    if (isNote) return // secure notes (API-sleutels) horen niet in het dashboard
    ws.eachRow((row, nr) => {
      if (nr === 1) return
      const v = (i: number): string => cell(row.getCell(i).value).trim()
      const title = v(2)
      if (!title) return
      out.push({
        group: groupFor(title, isNote),
        entry: {
          id: crypto.randomUUID(),
          title,
          kind: isNote ? 'note' : 'login',
          urls: v(4).split(/\s+/).filter(Boolean),
          username: v(5) || undefined,
          password: v(6) || undefined,
          notes: v(7) || undefined,
          extra: v(8) || undefined,
          updatedAt: now
        }
      })
    })
  })
  return out
}

function readQrExports(dir: string): MigratedOtp[] {
  const all = new Map<string, MigratedOtp>()
  for (const f of fs.readdirSync(dir)) {
    if (!/\.jpe?g$/i.test(f)) continue
    for (const payload of findQrPayloads(path.join(dir, f))) {
      if (!payload.startsWith('otpauth-migration://')) continue
      for (const otp of parseMigration(payload)) all.set(`${otp.issuer}|${otp.name}|${otp.secret}`, otp)
    }
  }
  return [...all.values()]
}

/** Haalt een geheim uit een tekstbestand met een reguliere expressie, zonder het af te drukken. */
function grab(file: string, re: RegExp): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').match(re)?.[1]
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const excel = path.join(handoverDir, 'Icares1PasswordExport_onbeveiligd.xlsx')
  const rows = await readExcel(excel)
  const otps = readQrExports(handoverDir)
  let attached = 0
  const toTotp = (o: MigratedOtp): TotpConfig => ({
    secret: o.secret, issuer: o.issuer, label: o.name, algorithm: o.algorithm, digits: o.digits, period: o.period
  })

  for (const otp of otps) {
    const m = TOTP_MATCH.find((x) => x.issuer === otp.issuer && x.name === otp.name)
    const row = m && rows.find((r) => r.entry.title === m.title)
    if (row) {
      row.entry.totp = toTotp(otp)
      attached++
    } else {
      // Geen bijbehorend wachtwoorditem: los 2FA-item maken
      const title = `${otp.issuer ?? '2FA'} (${otp.name})`
      rows.push({
        group: groupFor(title, false),
        entry: { id: crypto.randomUUID(), title, kind: 'login', urls: [], username: otp.name, totp: toTotp(otp), notes: '2FA-code uit de Google Authenticator-export van Robert.', updatedAt: now }
      })
    }
  }

  // Extra items uit de overdrachtsdocumenten en scripts
  const doc = await readDocx(path.join(handoverDir, 'Werk_overdracht_RJ.docx'))
  const sshPass = doc.match(/id_rsa,\s*ww:\s*([^)]+)\)/)?.[1]?.trim()
  if (sshPass) {
    rows.push({
      group: 'servers',
      entry: {
        id: crypto.randomUUID(), title: 'SSH-sleutel productie/acceptance (id_rsa)', kind: 'login', urls: [],
        username: 'icaresdba', password: sshPass,
        notes: 'Passphrase van de SSH-sleutel id_rsa. Gebruikt voor de productie- en acceptance-server, MySQL Workbench (verbinding Icares_prod) en de database-tunnel van de scripts.\nLet op: deze passphrase stond in platte tekst in de overdracht; vervangen aanbevolen.',
        updatedAt: now
      }
    })
  }
  if (scriptsDir) {
    const dbPass = grab(path.join(scriptsDir, 'IPI-Development', '01_ipi_make_invoices.pl'), /\$pass_prod\s*=\s*"([^"]+)"/)
    if (dbPass) {
      rows.push({
        group: 'servers',
        entry: {
          id: crypto.randomUUID(), title: 'MySQL productie (icaresdba, scripts)', kind: 'login', urls: [],
          username: 'icaresdba', password: dbPass,
          notes: 'Databasewachtwoord dat de Perl-scripts gebruiken (via de tunnel op localhost:10000).\nLet op: dit wachtwoord staat nu nog in platte tekst in de scripts op SharePoint.',
          updatedAt: now
        }
      })
    }
  }

  if (scriptsDir) {
    const tfa = grab(path.join(scriptsDir, 'Clienten_verwijderen_htttp_POST_request', 'delete_client_batches_via_POST_request_from_csv.pl'), /\$totp_secret_b32\s*=\s*"([A-Z2-7]+)"/)
    if (tfa) {
      rows.push({
        group: 'servers',
        entry: {
          id: crypto.randomUUID(), title: 'Icares Professional beheerder (verwijderen)', kind: 'login', urls: ['https://platform.icares.com/auth/login'],
          totp: { secret: tfa, algorithm: 'SHA1', digits: 6, period: 30 },
          notes: 'Beheerdersaccount waarmee het dashboard personen verwijdert. 2FA-sleutel uit Roberts verwijderscript. Vul login en wachtwoord in via Bewerken.',
          updatedAt: now
        }
      })
    }
  }

  const groups = (Object.keys(GROUPS) as GroupKey[]).map((k) => ({
    name: GROUPS[k],
    entries: rows.filter((r) => r.group === k).map((r) => r.entry)
  }))

  const saPw = randomPassword()
  const adminPw = randomPassword()
  let file = createVault('Super admin (tijdelijk)', saPw, groups)
  const sa = openVault(file, saPw, (f) => (file = f))
  const mail = sa.info().groups.find((g) => g.name === GROUPS.mail)!
  sa.createUser('Test admin', 'admin', adminPw, [mail.id], ['linkchecker', 'ipi-nieuwe-clienten'])

  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.voor-seed.bak`)
  writeVaultFile(target, file)

  const creds = path.resolve('dev-credentials.local.txt')
  fs.writeFileSync(
    creds,
    [
      'TIJDELIJKE inloggegevens voor het ontwikkelen van het Icares Dashboard.',
      'Niet delen. Vervang ze door definitieve wachtwoorden als het dashboard klaar is.',
      '',
      `Super admin : ${saPw}`,
      `Test admin  : ${adminPw}   (alleen groep "${GROUPS.mail}" en 2 scripts)`,
      ''
    ].join('\r\n'),
    'utf8'
  )

  console.log(`Kluis geschreven naar ${target}`)
  console.log(`Items: ${rows.length} in ${groups.length} groepen; ${otps.length} 2FA-codes gevonden, ${attached} gekoppeld aan een bestaand item.`)
  for (const g of groups) console.log(`  - ${g.name}: ${g.entries.length}`)
  console.log(`Inloggegevens staan in ${creds}`)
}

function randomPassword(): string {
  const words = ['zon', 'helios', 'kluis', 'icares', 'quest', 'licht', 'sleutel', 'route', 'kompas', 'vonk']
  const pick = (): string => words[crypto.randomInt(words.length)]
  return `${pick()}-${pick()}-${pick()}-${crypto.randomInt(1000, 9999)}`
}

async function readDocx(file: string): Promise<string> {
  // exceljs bundelt jszip; daarmee lezen we word/document.xml
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  return xml
    .split(/<\/w:p>/)
    .map((p) => [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''))
    .join('\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
