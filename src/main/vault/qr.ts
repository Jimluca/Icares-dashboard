// QR-codes met 2FA lezen: een losse otpauth://-code (bij het instellen van 2FA)
// of een Google Authenticator-export (otpauth-migration://, meerdere accounts).
import jsQR from 'jsqr'
import type { TotpConfig } from '../../shared/types'
import { base32Encode } from './totp'

export interface FoundOtp extends TotpConfig {
  name: string
}

export interface Rgba {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Zoekt QR-codes in een afbeelding: eerst het geheel, dan tegels (voor afbeeldingen met meerdere codes). */
export function findQrPayloads(img: Rgba): string[] {
  const found = new Set<string>()
  const tryRegion = (x0: number, y0: number, w: number, h: number): void => {
    const buf = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      const src = ((y0 + y) * img.width + x0) * 4
      buf.set(img.data.subarray(src, src + w * 4), y * w * 4)
    }
    const r = jsQR(buf, w, h, { inversionAttempts: 'attemptBoth' })
    if (r?.data) found.add(r.data)
  }
  tryRegion(0, 0, img.width, img.height)
  if (found.size === 0) {
    for (const parts of [2, 3]) {
      const tw = Math.floor(img.width / parts)
      const th = Math.floor(img.height / parts)
      for (let i = 0; i < parts; i++) for (let j = 0; j < parts; j++) tryRegion(i * tw, j * th, tw, th)
    }
  }
  return [...found]
}

// --- minimale protobuf-lezer voor het migratieformaat ---
function readVarint(buf: Buffer, pos: { i: number }): number {
  let result = 0
  let shift = 0
  for (;;) {
    const b = buf[pos.i++]
    result += (b & 0x7f) * 2 ** shift
    if ((b & 0x80) === 0) return result
    shift += 7
  }
}

function readFields(buf: Buffer): Map<number, (number | Buffer)[]> {
  const out = new Map<number, (number | Buffer)[]>()
  const pos = { i: 0 }
  while (pos.i < buf.length) {
    const key = readVarint(buf, pos)
    const field = Math.floor(key / 8)
    const wire = key & 7
    let val: number | Buffer
    if (wire === 0) val = readVarint(buf, pos)
    else if (wire === 2) {
      const len = readVarint(buf, pos)
      val = buf.subarray(pos.i, pos.i + len)
      pos.i += len
    } else throw new Error(`Onverwacht protobuf-type ${wire}`)
    out.set(field, [...(out.get(field) ?? []), val])
  }
  return out
}

export function parseMigration(uri: string): FoundOtp[] {
  const data = new URL(uri).searchParams.get('data')
  if (!data) return []
  const payload = readFields(Buffer.from(data, 'base64'))
  return (payload.get(1) ?? []).flatMap((p) => {
    const f = readFields(p as Buffer)
    const str = (n: number): string => ((f.get(n)?.[0] as Buffer | undefined)?.toString('utf8') ?? '')
    const num = (n: number): number => (f.get(n)?.[0] as number | undefined) ?? 0
    if (num(6) === 1) return [] // HOTP (tellergebaseerd) ondersteunen we niet
    const alg = num(4)
    return [{
      name: str(2),
      issuer: str(3) || undefined,
      label: str(2),
      secret: base32Encode(f.get(1)![0] as Buffer),
      algorithm: alg === 2 ? 'SHA256' : alg === 3 ? 'SHA512' : 'SHA1',
      digits: num(5) === 2 ? 8 : 6,
      period: 30
    } satisfies FoundOtp]
  })
}

/** Zet een otpauth-configuratie om naar een otpauth://-link (voor het 2FA-veld). */
export function toOtpauthUri(o: TotpConfig & { name?: string }): string {
  const label = encodeURIComponent(o.label ?? o.name ?? '2FA')
  const q = new URLSearchParams({ secret: o.secret, algorithm: o.algorithm, digits: String(o.digits), period: String(o.period) })
  if (o.issuer) q.set('issuer', o.issuer)
  return `otpauth://totp/${label}?${q.toString()}`
}
