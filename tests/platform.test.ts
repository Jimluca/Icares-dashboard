// Test het inloggen en verwijderen tegen een nagebootst Icares Professional (geen echte server).
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PlatformClient, parseForms } from '../src/main/platform/client'

const deleted: number[] = []
const posts: Record<string, string>[] = []
let base = ''
let server: http.Server

function body(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((r) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => r(Object.fromEntries(new URLSearchParams(d))))
  })
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const cookie = req.headers.cookie ?? ''
    const logged = cookie.includes('sess=ok')
    const url = new URL(req.url!, base)
    if (url.pathname === '/auth/login' && req.method === 'GET') {
      res.setHeader('Set-Cookie', 'XSRF=abc; path=/')
      return res.end(`<form method="POST" action="/auth/login"><input type="hidden" name="_token" value="tok1"><input name="login"><input type="password" name="password"><input name="tfa"><button type="submit">Inloggen</button></form>`)
    }
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      const b = await body(req)
      posts.push(b)
      const ok = b._token === 'tok1' && b.login === 'admin@icares.nl' && b.password === 'geheim' && /^\d{6}$/.test(b.tfa) && cookie.includes('XSRF=abc')
      res.statusCode = 302
      if (ok) res.setHeader('Set-Cookie', 'sess=ok; path=/; HttpOnly')
      res.setHeader('Location', ok ? '/dashboard' : '/auth/login')
      return res.end()
    }
    if (url.pathname === '/dashboard') return res.end('welkom')
    const edit = url.pathname.match(/^\/users\/(\d+)\/edit$/)
    if (edit) {
      if (!logged) {
        res.statusCode = 302
        res.setHeader('Location', '/auth/login')
        return res.end()
      }
      const id = edit[1]
      if (id === '999') {
        res.statusCode = 404
        return res.end('niet gevonden')
      }
      return res.end(`
        <form method="POST" action="${base}/users/${id}"><input type="hidden" name="_token" value="tokE"><input name="email" value="x@y.nl"></form>
        <form method="POST" action="${base}/users/${id}/delete"><input type="hidden" name="_token" value="tokD"><input type="hidden" name="_method" value="DELETE"><input type="checkbox" name="confirm" value="1"><button>Verwijder</button></form>`)
    }
    const del = url.pathname.match(/^\/users\/(\d+)\/delete$/)
    if (del && req.method === 'POST') {
      const b = await body(req)
      posts.push(b)
      if (logged && b._token === 'tokD' && b._method === 'DELETE' && b.confirm === '1') deleted.push(Number(del[1]))
      res.statusCode = 302
      res.setHeader('Location', '/users')
      return res.end()
    }
    if (url.pathname === '/users') return res.end('lijst')
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

const cred = { login: 'admin@icares.nl', password: 'geheim', totp: () => '123456' }

describe('platformclient', () => {
  it('leest formulieren met verborgen velden', () => {
    const f = parseForms('<form action="/a/b" method="post"><input type="hidden" name="_token" value="t&amp;1"><input type="checkbox" name="c"><input type="submit" name="s"></form>', 'https://x.nl/p')
    expect(f).toEqual([{ action: 'https://x.nl/a/b', method: 'POST', fields: { _token: 't&1' } }])
  })

  it('weigert een fout wachtwoord met een duidelijke melding', async () => {
    const c = new PlatformClient(base)
    await expect(c.login({ ...cred, password: 'fout' })).rejects.toThrow(/Inloggen op Icares Professional mislukt/)
  })

  it('logt in, test zonder te verwijderen en verwijdert daarna echt', async () => {
    const c = new PlatformClient(base)
    await c.login(cred)
    expect(c.isLoggedIn).toBe(true)

    await c.deleteUser(42, false) // proef
    expect(deleted).toEqual([])

    await c.deleteUser(42, true)
    expect(deleted).toEqual([42])
    expect(posts.at(-1)).toMatchObject({ _token: 'tokD', _method: 'DELETE', confirm: '1' })
  })

  it('meldt een onbekende gebruiker', async () => {
    const c = new PlatformClient(base)
    await c.login(cred)
    await expect(c.deleteUser(999, true)).rejects.toThrow(/bestaat niet/)
  })

  it('meldt het als je niet ingelogd bent', async () => {
    const c = new PlatformClient(base)
    await expect(c.deleteUser(5, true)).rejects.toThrow(/Niet \(meer\) ingelogd/)
    expect(deleted).not.toContain(5)
  })
})
