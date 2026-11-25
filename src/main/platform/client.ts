// Inloggen op het beheerscherm van Icares Professional en daar iemand verwijderen
// via het verwijderformulier, net als Roberts delete_client_batches_via_POST_request_from_csv.pl.

export interface PlatformLogin {
  login: string
  password: string
  totp: () => string // levert de actuele 2FA-code
}

interface Form {
  action: string
  method: string
  fields: Record<string, string>
}

const decode = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : undefined
}

/** Haalt alle formulieren met hun (verborgen) velden uit een HTML-pagina. */
export function parseForms(html: string, baseUrl: string): Form[] {
  const forms: Form[] = []
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const action = new URL(attr(m[1], 'action') ?? '', baseUrl).toString()
    const fields: Record<string, string> = {}
    for (const inp of m[2].matchAll(/<input\b[^>]*>/gi)) {
      const name = attr(inp[0], 'name')
      const type = (attr(inp[0], 'type') ?? 'text').toLowerCase()
      if (!name || type === 'submit' || type === 'button') continue
      if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(inp[0])) continue
      fields[name] = attr(inp[0], 'value') ?? ''
    }
    forms.push({ action, method: (attr(m[1], 'method') ?? 'get').toUpperCase(), fields })
  }
  return forms
}

/** Kleine browser: onthoudt cookies en volgt redirects. */
export class PlatformClient {
  private cookies = new Map<string, string>()
  private loggedInAt = 0

  constructor(readonly baseUrl: string) {}

  private async request(url: string, init: { method?: string; body?: URLSearchParams } = {}): Promise<{ url: string; status: number; html: string }> {
    let current = url
    let method = init.method ?? 'GET'
    let body: URLSearchParams | undefined = init.body
    for (let hop = 0; hop < 10; hop++) {
      const res = await fetch(current, {
        method,
        body,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Icares Dashboard)',
          Accept: 'text/html,application/xhtml+xml',
          ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
        }
      })
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';')
        const i = pair.indexOf('=')
        if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).toString()
        if (res.status !== 307 && res.status !== 308) {
          method = 'GET'
          body = undefined
        }
        continue
      }
      return { url: current, status: res.status, html: await res.text() }
    }
    throw new Error('Te veel doorverwijzingen van het platform.')
  }

  get isLoggedIn(): boolean {
    return Date.now() - this.loggedInAt < 20 * 60 * 1000
  }

  async login(cred: PlatformLogin): Promise<void> {
    const page = await this.request(`${this.baseUrl}/auth/login`)
    const form = parseForms(page.html, page.url).find((f) => 'password' in f.fields && '_token' in f.fields)
    if (!form) throw new Error('Inlogformulier van Icares Professional niet gevonden.')
    // Niet inloggen vlak voordat de 2FA-code verloopt
    const remain = 30 - (Math.floor(Date.now() / 1000) % 30)
    if (remain < 5 && cred.totp()) await new Promise((r) => setTimeout(r, remain * 1000 + 300))
    const data = new URLSearchParams({ ...form.fields, login: cred.login, password: cred.password, tfa: cred.totp() })
    const res = await this.request(form.action, { method: 'POST', body: data })
    if (/\/auth\/login/.test(new URL(res.url).pathname)) {
      throw new Error(`Inloggen op Icares Professional mislukt. Controleer login, wachtwoord${cred.totp() ? ' en 2FA' : ' (en of dit account 2FA nodig heeft)'} van het beheerdersaccount in de kluis.`)
    }
    this.loggedInAt = Date.now()
  }

  /** Zoekt het verwijderformulier op de bewerkpagina. Met `submit=false` wordt alleen gecontroleerd. */
  async deleteUser(userId: number, submit: boolean): Promise<void> {
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Ongeldig user-id.')
    const page = await this.request(`${this.baseUrl}/users/${userId}/edit`)
    if (/\/auth\/login/.test(new URL(page.url).pathname)) {
      this.loggedInAt = 0
      throw new Error('Niet (meer) ingelogd op Icares Professional.')
    }
    if (page.status === 404) throw new Error(`Gebruiker ${userId} bestaat niet (meer) op het platform.`)
    const form = parseForms(page.html, page.url).find((f) => new RegExp(`/users/${userId}/delete$`).test(new URL(f.action).pathname))
    if (!form) throw new Error(`Verwijderformulier niet gevonden voor gebruiker ${userId} (geen rechten?).`)
    if (!submit) return
    const res = await this.request(form.action, { method: 'POST', body: new URLSearchParams({ ...form.fields, confirm: '1' }) })
    if (res.status >= 400) throw new Error(`Het platform weigerde het verwijderen (HTTP ${res.status}).`)
  }
}
