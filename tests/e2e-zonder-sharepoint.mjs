// Test: werkt het dashboard op een pc zonder de SharePoint-map "MT - Documents\Scripts"?
//   node tests/e2e-zonder-sharepoint.mjs   (raakt de echte server niet)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { _electron as electron } from 'playwright'
const root = path.resolve(import.meta.dirname, '..')
const SUPER = fs.readFileSync(path.join(root, 'dev-credentials.local.txt'), 'utf8').match(/Super admin\s*:\s*(\S+)/)[1]
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-sp-'))
fs.copyFileSync(path.join(process.env.APPDATA, 'IcaresDashboard', 'vault.json'), path.join(tmp, 'vault.json'))
const real = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'IcaresDashboard', 'settings.json'), 'utf8'))
fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ ...real, scriptsRoot: 'C:\BestaatNiet\Scripts', tunnel: { ...real.tunnel, host: 'bestaat-niet.invalid', localPort: 10998 }, knownHosts: {} }))
const exe = process.argv[2]
const app = exe
  ? await electron.launch({ executablePath: exe, env: { ...process.env, ICARES_VAULT: path.join(tmp, 'vault.json'), ICARES_SETTINGS: path.join(tmp, 'settings.json') } })
  : await electron.launch({ args: [path.join(root, 'out', 'main', 'index.js')], env: { ...process.env, ICARES_VAULT: path.join(tmp, 'vault.json'), ICARES_SETTINGS: path.join(tmp, 'settings.json') } })
const page = await app.firstWindow()
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FOUT'} ${n}${x ? ` (${x})` : ''}`) }
try {
  await page.getByLabel('Wachtwoord', { exact: true }).fill(SUPER)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await page.getByRole('heading', { name: 'Wachtwoorden' }).waitFor()
  await page.locator('nav').getByRole('button', { name: 'Scripts' }).click()
  for (const name of ['Nieuwe IPI-cliënten', 'Status IPI-facturen', 'Overzicht IPI-organisaties']) {
    await page.locator('.entry-row', { hasText: name }).click()
    await page.getByRole('button', { name: 'Uitvoeren' }).waitFor()
    ok(`${name}: ingebouwde kopie, Uitvoeren beschikbaar`, (await page.getByText('ingebouwde kopie').isVisible()) && (await page.getByRole('button', { name: 'Uitvoeren' }).isEnabled()))
  }
  await page.getByRole('button', { name: 'Uitvoeren' }).click()
  await page.locator('.toast-error').first().waitFor({ timeout: 20000 })
  const err = await page.locator('.toast-error').first().innerText()
  ok('SQL-script vindt zijn bestand en zoekt de server', !/niet gevonden: /.test(err) && /Server niet gevonden/.test(err), err)
  const copied = await page.evaluate(() => window.icares.copySql('ipi-status'))
  ok('SQL kopiëren werkt', copied.ok, copied.ok ? '' : copied.error)
  await page.locator('.entry-row', { hasText: 'Links checken' }).click()
  await page.locator('select option').nth(1).waitFor({ state: 'attached', timeout: 10000 }).catch(() => {})
  ok('linkchecker: instellingen uit ingebouwde kopie', (await page.locator('select option').count()) > 10)
  await page.locator('.entry-row', { hasText: 'IPI-facturen maken' }).click()
  ok('IPI-facturen: scherm beschikbaar', await page.locator('.ipi-mode').isVisible())
  const extra = await page.evaluate(() => window.icares.listScripts())
  for (const s of extra.value.filter((x) => x.kind === 'builtin' || x.kind === 'sql')) ok(`${s.title}: bruikbaar zonder SharePoint`, s.exists)
} catch (e) {
  fails++
  console.log('Afgebroken:', e.message.split('\n')[0])
} finally {
  await app.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.exit(fails ? 1 : 0)
