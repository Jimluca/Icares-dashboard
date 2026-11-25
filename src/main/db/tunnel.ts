// Ingebouwde SSH-tunnel naar de databaseserver.
// - De sleutel en passphrase komen uit de kluis; er staat geen sleutelbestand op de pc.
// - mysql2 praat rechtstreeks over de SSH-verbinding.
// - Daarnaast luisteren we op 127.0.0.1:<localPort>, zodat ook de oude
//   Perl-scripts en MySQL Workbench de tunnel kunnen gebruiken.
import crypto from 'node:crypto'
import net from 'node:net'
import ssh2, { type ClientChannel } from 'ssh2'
import type { TunnelState } from '../../shared/ipc'

// ssh2 is CommonJS; via de default-export werkt het in de ESM-build van Electron
const { Client, utils } = ssh2

export interface TunnelTarget {
  host: string
  port?: number
  user: string
  privateKey: string
  passphrase?: string
  remoteHost?: string
  remotePort: number
  localPort: number
  /** Bekende vingerafdruk van de server (sha256, base64). Leeg = eerste keer, dan vastleggen. */
  knownFingerprint?: string
}

/** Controleert of de sleutel leesbaar is met deze passphrase. Gooit een duidelijke fout als dat niet zo is. */
export function validatePrivateKey(text: string, passphrase?: string): void {
  const parsed = utils.parseKey(text, passphrase)
  if (parsed instanceof Error) {
    if (/passphrase|encrypted|decrypt/i.test(parsed.message)) {
      throw new Error('De sleutel kan niet geopend worden met de passphrase uit de kluis. Controleer het wachtwoordveld van het item.')
    }
    throw new Error(`Dit is geen geldige privé SSH-sleutel (${parsed.message}).`)
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (!key.isPrivateKey()) throw new Error('Dit is een publieke sleutel. Kies het bestand zonder .pub.')
}

export class Tunnel {
  private client: InstanceType<typeof Client> | null = null
  private server: net.Server | null = null
  private state: TunnelState = { open: false, connecting: false, localListening: false }
  private target: TunnelTarget | null = null

  constructor(
    private readonly onChange: (s: TunnelState) => void,
    private readonly onNewFingerprint: (fp: string) => void
  ) {}

  status(): TunnelState {
    return { ...this.state }
  }

  private set(patch: Partial<TunnelState>): void {
    this.state = { ...this.state, ...patch }
    this.onChange(this.status())
  }

  open(target: TunnelTarget): Promise<void> {
    if (this.state.open) return Promise.resolve()
    this.target = target
    this.set({ connecting: true, error: undefined })
    return new Promise((resolve, reject) => {
      const client = new Client()
      let settled = false
      const fail = (msg: string): void => {
        if (!settled) {
          settled = true
          reject(new Error(msg))
        }
        this.close(msg)
      }
      client.on('ready', () => {
        this.client = client
        settled = true
        this.set({ open: true, connecting: false, since: new Date().toISOString(), localPort: target.localPort })
        this.listenLocal(target)
        resolve()
      })
      client.on('error', (err) => fail(friendlySshError(err)))
      client.on('close', () => {
        if (this.state.open) this.close('De verbinding met de server is verbroken.')
      })
      try {
        client.connect({
          host: target.host,
          port: target.port ?? 22,
          username: target.user,
          privateKey: target.privateKey,
          passphrase: target.passphrase,
          readyTimeout: 20000,
          keepaliveInterval: 30000,
          hostVerifier: (key: Buffer) => {
            const fp = crypto.createHash('sha256').update(key).digest('base64')
            if (!target.knownFingerprint) {
              this.onNewFingerprint(fp)
              return true
            }
            if (fp !== target.knownFingerprint) return false // geeft "Host denied", zie friendlySshError
            return true
          }
        })
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e))
      }
    })
  }

  /** Een directe stroom naar de database, voor mysql2. */
  forward(): Promise<ClientChannel> {
    const c = this.client
    const t = this.target
    if (!c || !t || !this.state.open) return Promise.reject(new Error('De database-tunnel is niet open.'))
    return new Promise((resolve, reject) => {
      c.forwardOut('127.0.0.1', 0, t.remoteHost ?? '127.0.0.1', t.remotePort, (err, stream) => (err ? reject(err) : resolve(stream)))
    })
  }

  private listenLocal(t: TunnelTarget): void {
    const server = net.createServer((sock) => {
      this.forward()
        .then((stream) => {
          sock.pipe(stream).pipe(sock)
          const end = (): void => {
            sock.destroy()
            stream.destroy()
          }
          sock.on('error', end)
          stream.on('error', end)
          sock.on('close', end)
        })
        .catch(() => sock.destroy())
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      this.server = null
      this.set({
        localListening: false,
        error: err.code === 'EADDRINUSE'
          ? `Poort ${t.localPort} is al in gebruik (staat er nog een andere tunnel open?). Het dashboard zelf werkt wel; losse scripts kunnen de tunnel niet gebruiken.`
          : `Lokale poort kon niet geopend worden: ${err.message}`
      })
    })
    server.listen(t.localPort, '127.0.0.1', () => {
      this.server = server
      this.set({ localListening: true })
    })
  }

  close(error?: string): void {
    this.server?.close()
    this.server = null
    this.client?.end()
    this.client = null
    this.set({ open: false, connecting: false, localListening: false, error, since: undefined })
  }
}

function friendlySshError(err: Error & { level?: string; code?: string }): string {
  const m = err.message
  if (/Host denied/i.test(m)) {
    return 'De server stelt zich anders voor dan eerder (andere vingerafdruk). Uit veiligheid is de verbinding geweigerd. Vraag na of de server vernieuwd is.'
  }
  if (err.level === 'client-authentication' || /authentication/i.test(m)) {
    return 'De server weigert de SSH-sleutel. Mogelijk is de sleutel van Robert ingetrokken of hoort deze sleutel niet bij deze gebruiker.'
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'Server niet gevonden. Controleer de internetverbinding en de servernaam.'
  if (/ETIMEDOUT|Timed out/i.test(m)) return 'De server reageert niet (time-out). Mogelijk blokkeert een firewall poort 22.'
  if (/ECONNREFUSED/.test(m)) return 'De server weigert de verbinding op poort 22.'
  if (/passphrase|decrypt/i.test(m)) return 'De passphrase van de SSH-sleutel klopt niet.'
  return `SSH-fout: ${m}`
}
