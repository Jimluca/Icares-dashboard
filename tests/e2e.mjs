// End-to-end-test van het echte programma met Playwright.
// Gebruikt een KOPIE van de lokale kluis, zodat de test niets wijzigt.
// Wachtwoorden komen uit dev-credentials.local.txt.
//   node tests/e2e.mjs
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const shots = path.join(root, 'test-output')
fs.mkdirSync(shots, { recursive: true })

const creds = fs.readFileSync(path.join(root, 'dev-credentials.local.txt'), 'utf8')
const SUPER = creds.match(/Super admin\s*:\s*(\S+)/)[1]
const ADMIN = creds.match(/Test admin\s*:\s*(\S+)/)[1]

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icares-e2e-'))
const vault = path.join(tmp, 'vault.json')
fs.copyFileSync(path.join(process.env.APPDATA, 'IcaresDashboard', 'vault.json'), vault)
// Eigen instellingen: de tunnel wijst naar een server die niet bestaat, zodat de test nooit de echte database raakt
const settingsFile = path.join(tmp, 'settings.json')
const realSettings = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'IcaresDashboard', 'settings.json'), 'utf8'))
fs.writeFileSync(settingsFile, JSON.stringify({ ...realSettings, tunnel: { ...realSettings.tunnel, host: 'bestaat-niet.invalid', localPort: 10999 }, knownHosts: {} }))

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'OK  ' : 'FOUT'} ${name}${extra ? ` (${extra})` : ''}`)
}

// Kleine lokale webserver voor de linkchecker-test
const web = http.createServer((req, res) => {
  if (req.url === '/ok') return res.end('<html><body>ok</body></html>')
  if (req.url === '/redir') {
    res.writeHead(302, { Location: '/ok' })
    return res.end()
  }
  res.writeHead(404)
  res.end('<html><body>weg</body></html>')
})
await new Promise((r) => web.listen(0, '127.0.0.1', r))
const webBase = `http://127.0.0.1:${web.address().port}`

const app = await electron.launch({ args: [path.join(root, 'out', 'main', 'index.js')], env: { ...process.env, ICARES_VAULT: vault, ICARES_SETTINGS: settingsFile } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.setViewportSize({ width: 1280, height: 820 })

try {
  const pw = page.getByLabel('Wachtwoord')
  await pw.waitFor()
  await page.screenshot({ path: path.join(shots, '01-inloggen.png') })

  // fout wachtwoord
  await pw.fill('dit-is-niet-goed-123')
  await page.getByRole('button', { name: 'Inloggen' }).click()
  check('fout wachtwoord geweigerd', await page.getByText('Onjuist wachtwoord').isVisible({ timeout: 10000 }).catch(() => false))

  // super admin
  await pw.fill(SUPER)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await page.getByRole('heading', { name: 'Wachtwoorden' }).waitFor({ timeout: 15000 })
  const all = await page.locator('.chip').first().innerText()
  check('super admin ziet alle items', /42/.test(all), all.replace(/\s+/g, ' '))
  check('super admin ziet 6 groepen', (await page.locator('.chip').count()) === 7)
  check('menu Beheer zichtbaar voor super admin', await page.getByRole('button', { name: 'Beheer', exact: true }).isVisible())

  // zoeken + 2FA
  await page.getByPlaceholder('Zoeken').fill('IAM')
  await page.locator('.entry-row', { hasText: 'IAM login' }).click()
  await page.locator('.totp').waitFor({ timeout: 5000 })
  const code = (await page.locator('.totp').innerText()).replace(/\s/g, '')
  check('2FA-code wordt getoond', /^\d{6}$/.test(code))
  check('wachtwoord standaard verborgen', (await page.locator('.field-row').filter({ has: page.locator('.field-label', { hasText: /^Wachtwoord$/ }) }).innerText()).includes('••••'))
  await page.screenshot({ path: path.join(shots, '02-wachtwoorden.png') })

  // kopiëren -> melding
  await page.locator('.field-row').filter({ has: page.locator('.field-label', { hasText: /^Gebruikersnaam$/ }) }).getByTitle('Kopiëren').click()
  await page.locator('.toast').first().waitFor({ timeout: 5000 }).catch(() => {})
  const toastText = await page.locator('.toast').allInnerTexts()
  check('kopiëren geeft melding', toastText.some((t) => t.includes('Gebruikersnaam gekopieerd')), toastText.join(' / '))

  // scripts
  await page.getByRole('button', { name: 'Scripts' }).click()
  await page.getByRole('heading', { name: 'Scripts' }).waitFor()
  await page.locator('.list-pane .entry-row').first().waitFor()
  const nScripts = await page.locator('.list-pane .entry-row').count()
  check('alle 10 scripts zichtbaar', nScripts === 10, String(nScripts))
  // IPI-facturatie (ingebouwd): testmodus staat standaard aan
  await page.locator('.entry-row', { hasText: 'IPI-facturen maken en versturen' }).click()
  await page.locator('.ipi-mode').waitFor()
  check('IPI: testmodus staat standaard aan', await page.locator('.ipi-mode input[type=checkbox]').isChecked())
  check('IPI: waarschuwing zichtbaar', await page.locator('.notice-danger').isVisible())
  await page.locator('.ipi-mode input[type=checkbox]').uncheck()
  check('IPI: testmodus uit wordt rood gemarkeerd', await page.locator('.ipi-mode.is-live').isVisible())
  await page.locator('.ipi-mode input[type=checkbox]').check()
  await page.getByRole('button', { name: 'Nieuwe cliënten ophalen' }).click()
  await page.locator('.toast-error').first().waitFor({ timeout: 15000 })
  check('IPI: zonder bereikbare server een duidelijke melding', /Server niet gevonden/.test(await page.locator('.toast-error').first().innerText()))
  await page.screenshot({ path: path.join(shots, '03-ipi.png') })

  // Betaalde IPI-facturen (ingebouwd)
  await page.locator('.entry-row', { hasText: 'Betaalde IPI-facturen' }).click()
  await page.getByRole('button', { name: 'Openstaande facturen ophalen' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-error')].some((t) => /Server niet gevonden/.test(t.textContent ?? '')), null, { timeout: 15000 }).catch(() => {})
  check('betaalde facturen: ingebouwd scherm met duidelijke melding', await page.locator('.toast-error', { hasText: 'Server niet gevonden' }).first().isVisible())

  // Personen verwijderen (ingebouwd)
  await page.locator('.entry-row', { hasText: 'Personen beheren' }).click()
  check('personen beheren: zoekveld voor organisatie', await page.getByPlaceholder('Typ de naam').isVisible())
  await page.getByPlaceholder('Typ de naam').fill('Hanze')
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-error')].some((t) => /Server niet gevonden/.test(t.textContent ?? '')), null, { timeout: 15000 }).catch(() => {})
  check('personen beheren: duidelijke melding zonder server', await page.locator('.toast-error', { hasText: 'Server niet gevonden' }).first().isVisible())
  await page.screenshot({ path: path.join(shots, '10-personen.png') })

  // Perl-script met waarschuwing: bevestiging verschijnt, maar we starten NIET
  await page.locator('.entry-row', { hasText: 'EDU-dex' }).click()
  await page.locator('.reqs li.ok, .reqs li.nok').first().waitFor({ timeout: 60000 })
  check('perl-script gevonden in scriptmap', await page.getByRole('button', { name: 'Start' }).isEnabled())

  // SQL-script: tunnelbalk en duidelijke melding zolang de sleutel ontbreekt
  await page.locator('.entry-row', { hasText: 'Status IPI-facturen' }).click()
  await page.locator('.tunnel').waitFor()
  check('SQL-script heeft knop Uitvoeren', await page.getByRole('button', { name: 'Uitvoeren' }).isVisible())
  check('geen MySQL Workbench meer nodig', !(await page.getByText('MySQL Workbench').isVisible()))
  await page.getByRole('button', { name: 'Uitvoeren' }).click()
  await page.locator('.toast-error').first().waitFor({ timeout: 10000 })
  const sqlErr = await page.locator('.toast-error').first().innerText()
  check('onbereikbare server: duidelijke melding', /niet gevonden|SSH-sleutel|reageert niet|weigert/.test(sqlErr), sqlErr)
  await page.screenshot({ path: path.join(shots, '07-sql-script.png') })

  // linkchecker: instellingen uit Roberts SQL-bestand + echte controle via de ingebouwde browser
  await page.locator('.entry-row', { hasText: 'Links checken' }).click()
  await page.locator('select option').nth(1).waitFor({ state: 'attached', timeout: 10000 }).catch(() => {})
  const nInst = await page.locator('select option').count()
  check('linkchecker kent de instellingen uit het SQL-bestand', nInst > 10, `${nInst - 1} instellingen`)
  const lc = await page.evaluate((base) => window.icares.linkCheck([`${base}/ok`, `${base}/redir`, `${base}/weg`, 'geen-url']), webBase)
  const byUrl = Object.fromEntries((lc.ok ? lc.value : []).map((r) => [r.url, r]))
  check('linkchecker: werkende link', byUrl[`${webBase}/ok`]?.ok === true && byUrl[`${webBase}/ok`]?.status === '200')
  check('linkchecker: omleiding gevolgd', byUrl[`${webBase}/redir`]?.ok === true && byUrl[`${webBase}/redir`]?.finalUrl.endsWith('/ok'), byUrl[`${webBase}/redir`]?.redirects)
  check('linkchecker: 404 herkend', byUrl[`${webBase}/weg`]?.ok === false && byUrl[`${webBase}/weg`]?.status === '404', byUrl[`${webBase}/weg`]?.status)
  check('linkchecker: ongeldige link herkend', byUrl['geen-url']?.ok === false)
  await page.screenshot({ path: path.join(shots, '08-linkchecker.png') })

  // deze pc
  await page.getByRole('button', { name: 'Deze pc' }).click()
  await page.locator('.table .pill').first().waitFor({ timeout: 90000 })
  const rows = await page.locator('.table tr').allInnerTexts()
  console.log('     pc-controle:', rows.map((r) => r.split('\n').filter(Boolean).slice(0, 2).join(' ')).join(' | '))
  await page.screenshot({ path: path.join(shots, '04-deze-pc.png'), fullPage: true })
  check('deze pc legt uit welke scripts nog Perl nodig hebben', await page.getByText('Zodra die ook zijn ingebouwd').isVisible())

  // administratie (echte app, alleen lezen bij opstarten)
  await page.locator('nav').getByRole('button', { name: 'Administratie', exact: true }).click()
  await page.locator('.admin-bar, .page .notice').first().waitFor({ timeout: 60000 }).catch(() => {})
  let adminFrame = null
  for (let i = 0; i < 60 && !adminFrame; i++) {
    adminFrame = page.frames().find((f) => f.url().startsWith('http://127.0.0.1:47815')) ?? null
    if (!adminFrame) await page.waitForTimeout(500)
  }
  if (adminFrame) await adminFrame.waitForLoadState('domcontentloaded').catch(() => {})
  const adminText = adminFrame ? await adminFrame.locator('body').innerText().catch(() => '') : await page.locator('main').innerText().catch(() => '')
  check('administratie draait in het dashboard', !!adminFrame && /Overzicht/.test(adminText), adminFrame ? '' : adminText.slice(0, 160))
  await page.screenshot({ path: path.join(shots, '11-administratie.png') })

  // beheer
  await page.getByRole('button', { name: 'Beheer', exact: true }).click()
  await page.locator('.table tbody tr').first().waitFor()
  check('beheer toont 2 gebruikers', (await page.locator('.table tbody tr').count()) === 2)
  await page.getByRole('button', { name: 'Rechten', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.screenshot({ path: path.join(shots, '05-rechten.png') })
  await page.getByRole('button', { name: 'Annuleren' }).click()
  await page.getByRole('button', { name: 'Database-koppeling' }).click()
  await page.locator('.pill', { hasText: /SSH-sleutel/ }).waitFor()
  check('database-koppeling toont sleutelstatus', (await page.locator('.pill', { hasText: /SSH-sleutel/ }).innerText()).length > 0, await page.locator('.pill', { hasText: /SSH-sleutel/ }).innerText())
  await page.screenshot({ path: path.join(shots, '09-database-koppeling.png'), fullPage: true })

  // vergrendelen en als admin inloggen
  await page.getByRole('button', { name: 'Vergrendelen' }).click()
  await page.locator('.login-card').waitFor()
  await page.getByLabel('Wachtwoord', { exact: true }).fill(ADMIN)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await page.getByRole('heading', { name: 'Wachtwoorden' }).waitFor({ timeout: 15000 })
  check('admin ziet alleen 1 groep', (await page.locator('.chip').count()) === 2)
  check('admin ziet alleen 13 mail-items', /13/.test(await page.locator('.chip').first().innerText()))
  check('admin ziet geen Administratie zonder recht', !(await page.getByRole('button', { name: 'Administratie', exact: true }).isVisible()))
  check('admin heeft geen Beheer', !(await page.getByRole('button', { name: 'Beheer', exact: true }).isVisible()))
  const refused = await page.evaluate(() => window.icares.listUsers())
  check('admin kan gebruikerslijst niet opvragen via de achterdeur', refused.ok === false)
  await page.getByRole('button', { name: 'Scripts' }).click()
  await page.getByRole('heading', { name: 'Scripts' }).waitFor()
  await page.locator('.list-pane .entry-row').first().waitFor()
  check('admin ziet alleen 2 scripts', (await page.locator('.list-pane .entry-row').count()) === 2)
  const blocked = await page.evaluate(() => window.icares.runScript('clienten-verwijderen', {}))
  check('admin kan niet-toegestaan script niet starten', blocked.ok === false)
  await page.screenshot({ path: path.join(shots, '06-admin.png') })

  check('geen fouten in de console', errors.length === 0, errors.join(' / '))
} catch (e) {
  console.error('Test afgebroken:', e.message)
  await page.screenshot({ path: path.join(shots, 'fout.png') }).catch(() => {})
  results.push({ name: 'afgebroken', ok: false })
} finally {
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10000))])
  web.closeAllConnections()
  web.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} geslaagd`)
process.exit(failed.length ? 1 : 0)
