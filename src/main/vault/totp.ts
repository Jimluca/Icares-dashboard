// TOTP-codes (zoals Google Authenticator) en het lezen van otpauth-links.
import crypto from 'node:crypto'
import type { TotpConfig } from '../../shared/types'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx < 0) throw new Error('Ongeldige 2FA-sleutel (geen base32).')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function totpCode(cfg: TotpConfig, nowMs = Date.now()): { code: string; secondsLeft: number } {
  const counter = Math.floor(nowMs / 1000 / cfg.period)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac(cfg.algorithm.toLowerCase(), base32Decode(cfg.secret)).update(msg).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** cfg.digits
  const secondsLeft = cfg.period - (Math.floor(nowMs / 1000) % cfg.period)
  return { code: bin.toString().padStart(cfg.digits, '0'), secondsLeft }
}

/** Accepteert een otpauth://totp/...-link of een kale base32-sleutel. */
export function parseTotp(input: string): TotpConfig {
  const s = input.trim()
  if (!s.toLowerCase().startsWith('otpauth://')) {
    base32Decode(s) // valideert
    return { secret: s.toUpperCase().replace(/[\s=-]/g, ''), algorithm: 'SHA1', digits: 6, period: 30 }
  }
  const url = new URL(s)
  if (url.hostname !== 'totp') throw new Error('Alleen tijdgebaseerde (TOTP) codes worden ondersteund.')
  const secret = url.searchParams.get('secret')
  if (!secret) throw new Error('De link bevat geen sleutel.')
  base32Decode(secret)
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const alg = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()
  return {
    secret: secret.toUpperCase(),
    issuer: url.searchParams.get('issuer') ?? (label.includes(':') ? label.split(':')[0] : undefined),
    label,
    algorithm: alg === 'SHA256' || alg === 'SHA512' ? alg : 'SHA1',
    digits: Number(url.searchParams.get('digits') ?? 6),
    period: Number(url.searchParams.get('period') ?? 30)
  }
}
