// Test de tunnel tegen een nagebootste SSH-server die doorstuurt naar een echo-server.
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Server, utils } from 'ssh2'
import { Tunnel, validatePrivateKey } from '../src/main/db/tunnel'
import { cleanSql } from '../src/main/db/query'

const PASS = 'test-passphrase-123'
const clientKey = utils.generateKeyPairSync('ed25519', { passphrase: PASS, cipher: 'aes256-ctr', rounds: 16 })
const otherKey = utils.generateKeyPairSync('ed25519')
const hostKey = utils.generateKeyPairSync('ed25519')
const allowedPub = utils.parseKey(clientKey.public) as ReturnType<typeof utils.parseKey> & { getPublicSSH(): Buffer }

let sshPort = 0
let echoPort = 0
let sshServer: Server
let echo: net.Server

beforeAll(async () => {
  echo = net.createServer((s) => s.pipe(s))
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r))
  echoPort = (echo.address() as net.AddressInfo).port

  sshServer = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'publickey' && ctx.key.data.equals(allowedPub.getPublicSSH())) return ctx.accept()
      ctx.reject(['publickey'])
    })
    client.on('ready', () => {
      client.on('tcpip', (accept, _reject, info) => {
        const stream = accept()
        const sock = net.connect(info.destPort, '127.0.0.1')
        stream.pipe(sock).pipe(stream)
      })
    })
    client.on('error', () => {})
  })
  await new Promise<void>((r) => sshServer.listen(0, '127.0.0.1', r))
  sshPort = (sshServer.address() as net.AddressInfo).port
})

afterAll(() => {
  sshServer.close()
  echo.close()
})

function target(over: Partial<Parameters<Tunnel['open']>[0]> = {}): Parameters<Tunnel['open']>[0] {
  return { host: '127.0.0.1', port: sshPort, user: 'icaresdba', privateKey: clientKey.private, passphrase: PASS, remotePort: echoPort, localPort: 0, ...over }
}

describe('tunnel', () => {
  it('verbindt met sleutel + passphrase en stuurt verkeer door', async () => {
    let fp = ''
    const t = new Tunnel(() => {}, (f) => (fp = f))
    await t.open(target({ localPort: 0 }))
    expect(t.status().open).toBe(true)
    expect(fp).toMatch(/=$/)
    const stream = await t.forward()
    const reply = await new Promise<string>((resolve) => {
      stream.once('data', (d: Buffer) => resolve(d.toString()))
      stream.write('hallo')
    })
    expect(reply).toBe('hallo')
    stream.destroy()
    t.close()
    expect(t.status().open).toBe(false)
  })

  it('luistert lokaal voor losse scripts', async () => {
    const t = new Tunnel(() => {}, () => {})
    const free = await new Promise<number>((r) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port
        s.close(() => r(p))
      })
    })
    await t.open(target({ localPort: free }))
    await new Promise((r) => setTimeout(r, 100))
    expect(t.status().localListening).toBe(true)
    const reply = await new Promise<string>((resolve, reject) => {
      const c = net.connect(free, '127.0.0.1', () => c.write('ping'))
      c.once('data', (d) => {
        resolve(d.toString())
        c.destroy()
      })
      c.once('error', reject)
    })
    expect(reply).toBe('ping')
    t.close()
  })

  it('geeft een duidelijke fout bij een verkeerde sleutel', async () => {
    const t = new Tunnel(() => {}, () => {})
    await expect(t.open(target({ privateKey: otherKey.private, passphrase: undefined }))).rejects.toThrow(/weigert de SSH-sleutel/)
  })

  it('weigert een server met een andere vingerafdruk', async () => {
    const t = new Tunnel(() => {}, () => {})
    await expect(t.open(target({ knownFingerprint: 'AAAAndersAAAA=' }))).rejects.toThrow(/vingerafdruk/)
  })

  it('controleert sleutel en passphrase bij importeren', () => {
    expect(() => validatePrivateKey(clientKey.private, PASS)).not.toThrow()
    expect(() => validatePrivateKey(clientKey.private, 'fout')).toThrow(/passphrase/)
    expect(() => validatePrivateKey(clientKey.public)).toThrow()
    expect(() => validatePrivateKey('geen sleutel')).toThrow()
  })
})

describe('SQL opschonen', () => {
  it('haalt commentaar en ; weg', () => {
    expect(cleanSql("select 1 -- uitleg\nfrom dual;\n")).toBe('select 1 \nfrom dual')
    expect(cleanSql("select '--geen commentaar' as x # weg")).toBe("select '--geen commentaar' as x")
  })
  it('weigert schrijf-SQL en meerdere statements', () => {
    expect(() => cleanSql('update users set x=1')).toThrow(/SELECT/)
    expect(() => cleanSql('select 1; delete from users')).toThrow(/meerdere/)
  })
  it('accepteert Roberts IPI-query met commentaar achter de having', () => {
    const s = cleanSql("select a from b\nhaving `x` != 0 AND `y` = 'OPEN' -- AND `org-id` = 679 --\norder by `x` desc")
    expect(s).toContain("`y` = 'OPEN'")
    expect(s).not.toContain('679')
  })
})
