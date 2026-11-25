// Cryptografische bouwstenen van de kluis.
// - AES-256-GCM voor alle versleutelde data
// - scrypt om van een wachtwoord een sleutel te maken
// - X25519 "sealed box" om groepssleutels voor een gebruiker te verpakken,
//   zodat de super admin een groep kan delen zonder het wachtwoord van de admin te kennen.
import crypto from 'node:crypto'

export interface EncBlob {
  iv: string
  ct: string
  tag: string
}

export interface SealedBox extends EncBlob {
  epk: string // tijdelijke publieke sleutel (spki der, base64)
}

export interface KdfParams {
  salt: string
  N: number
  r: number
  p: number
}

const b64 = (b: Buffer): string => b.toString('base64')
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64')

export function randomKey(): Buffer {
  return crypto.randomBytes(32)
}

export function newKdfParams(): KdfParams {
  return { salt: b64(crypto.randomBytes(16)), N: 2 ** 15, r: 8, p: 1 }
}

export function deriveKey(password: string, kdf: KdfParams): Buffer {
  return crypto.scryptSync(password.normalize('NFC'), unb64(kdf.salt), 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 128 * kdf.N * kdf.r * 2
  })
}

export function encrypt(key: Buffer, plaintext: Buffer, aad: string): EncBlob {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { iv: b64(iv), ct: b64(ct), tag: b64(cipher.getAuthTag()) }
}

/** Gooit een fout als de sleutel niet klopt of de data is aangepast. */
export function decrypt(key: Buffer, blob: EncBlob, aad: string): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(blob.iv))
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(unb64(blob.tag))
  return Buffer.concat([decipher.update(unb64(blob.ct)), decipher.final()])
}

export function encryptJson(key: Buffer, value: unknown, aad: string): EncBlob {
  return encrypt(key, Buffer.from(JSON.stringify(value), 'utf8'), aad)
}

export function decryptJson<T>(key: Buffer, blob: EncBlob, aad: string): T {
  return JSON.parse(decrypt(key, blob, aad).toString('utf8')) as T
}

export interface KeyPair {
  publicKey: string // spki der base64
  privateKey: crypto.KeyObject
}

export function newKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  return { publicKey: b64(publicKey.export({ type: 'spki', format: 'der' })), privateKey }
}

export function exportPrivateKey(key: crypto.KeyObject): Buffer {
  return key.export({ type: 'pkcs8', format: 'der' })
}

export function importPrivateKey(der: Buffer): crypto.KeyObject {
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
}

function importPublicKey(spkiB64: string): crypto.KeyObject {
  return crypto.createPublicKey({ key: unb64(spkiB64), format: 'der', type: 'spki' })
}

function boxKey(shared: Buffer, epk: string, recipient: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', shared, Buffer.alloc(0), `icares-seal|${epk}|${recipient}`, 32)
  )
}

/** Verpakt een geheim zodat alleen de houder van de privésleutel het kan openen. */
export function seal(recipientPublicKey: string, secret: Buffer, aad: string): SealedBox {
  const eph = crypto.generateKeyPairSync('x25519')
  const epk = b64(eph.publicKey.export({ type: 'spki', format: 'der' }))
  const shared = crypto.diffieHellman({
    privateKey: eph.privateKey,
    publicKey: importPublicKey(recipientPublicKey)
  })
  const blob = encrypt(boxKey(shared, epk, recipientPublicKey), secret, aad)
  return { ...blob, epk }
}

export function unseal(
  privateKey: crypto.KeyObject,
  ownPublicKey: string,
  box: SealedBox,
  aad: string
): Buffer {
  const shared = crypto.diffieHellman({ privateKey, publicKey: importPublicKey(box.epk) })
  return decrypt(boxKey(shared, box.epk, ownPublicKey), box, aad)
}

export function randomId(): string {
  return crypto.randomUUID()
}
