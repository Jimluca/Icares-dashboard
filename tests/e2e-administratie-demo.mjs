// Test: demo-administratie op een "andere pc" (geen Python-installatie, geen Wefact-map).
// Het demopakket bevat alleen de app-code en een lege WeFact-opname: er gaan geen echte gegevens mee.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { _electron as electron } from 'playwright'
const root = path.resolve(import.meta.dirname, '..')
const SUPER = fs.readFileSync(path.join(root, 'dev-credentials.local.txt'), 'utf8').match(/Super admin\s*:\s*(\S+)/)[1]
const appSrc = path.join(os.homedir(), 'OneDrive - Icares B.V', 'Bureaublad', 'Wefact automatisering', 'overzicht', 'overzicht')
const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-pc-'))
const local = path.join(fake, 'Local'); const roaming = path.join(fake, 'Roaming')
const demo = path.join(local, 'IcaresDashboard', 'administratie-demo')
fs.cpSync(appSrc, path.join(demo, 'overzicht', 'overzicht'), { recursive: true, filter: (s) => !/__pycache__/.test(s) })
fs.writeFileSync(path.join(demo, 'demo-wefact.json'), JSON.stringify({ vastgelegd: 'test', aanroepen: {} }))
fs.mkdirSync(path.join(roaming, 'IcaresDashboard'), { recursive: true })
fs.copyFileSync(path.join(process.env.APPDATA, 'IcaresDashboard', 'vault.json'), path.join(roaming, 'IcaresDashboard', 'vault.json'))
const exe = process.argv[2]
const env = { ...process.env, LOCALAPPDATA: local, APPDATA: roaming, ICARES_ADMIN_FORCE_DEMO: '1' }
const app = exe ? await electron.launch({ executablePath: exe, env }) : await electron.launch({ args: [path.join(root, 'out', 'main', 'index.js')], env })
const page = await app.firstWindow()
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'OK  ' : 'FOUT'} ${n}${x ? ` (${x})` : ''}`) }
try {
  await page.getByLabel('Wachtwoord', { exact: true }).fill(SUPER)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  await page.getByRole('heading', { name: 'Wachtwoorden' }).waitFor()
  await page.locator('nav').getByRole('button', { name: 'Administratie', exact: true }).click()
  await page.locator('.admin-bar, .page .notice-danger').first().waitFor({ timeout: 60000 })
  const err = await page.locator('.page .notice-danger').innerText().catch(() => '')
  ok('demo-administratie start met de ingebouwde Python', !err, err)
  ok('demobalk zichtbaar', await page.locator('.admin-bar.is-demo').isVisible())
  let frame = null
  for (let i = 0; i < 60 && !frame; i++) { frame = page.frames().find((f) => f.url().startsWith('http://127.0.0.1:47816')) ?? null; if (!frame) await page.waitForTimeout(500) }
  ok('demo draait op poort 47816 in het dashboard', !!frame)
  if (frame) {
    await frame.waitForLoadState('domcontentloaded')
    ok('schermen van de administratie zichtbaar', /Overzicht/.test(await frame.locator('body').innerText()))
    const r = await frame.evaluate(async () => (await fetch('/api/bijwerken', { method: 'POST', headers: { 'X-Token': document.querySelector('meta[name="token"]').content } })).status)
    ok('Bijwerken-knop wordt geaccepteerd', r < 400, String(r))
    await page.waitForTimeout(2500)
    const st = await frame.evaluate(async () => (await fetch('/api/status')).json())
    ok('Bijwerken is uitgeschakeld in de demo', /Demo: BVKostenBaten wordt in de demo niet bijgewerkt/.test(st.fout ?? ''), st.fout)
  }
  await page.screenshot({ path: path.join(root, 'test-output', '13-administratie-demo.png') })
} catch (e) { fails++; console.log('Afgebroken:', e.message.split('\n')[0]) }
finally {
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 8000))])
  // demo-proces afsluiten
  try { const r = await fetch('http://127.0.0.1:47816/ping'); if (r.ok) console.log('(demo-server draait nog; wordt bij afsluiten opgeruimd)') } catch {}
}
process.exit(fails ? 1 : 0)
