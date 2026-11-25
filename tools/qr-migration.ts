// Voor het seed-script: leest QR-codes uit JPEG-bestanden (buiten Electron).
import fs from 'node:fs'
import jpeg from 'jpeg-js'
import { findQrPayloads as findInRgba, parseMigration, type FoundOtp } from '../src/main/vault/qr'

export type MigratedOtp = FoundOtp
export { parseMigration }

export function findQrPayloads(file: string): string[] {
  const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true, maxMemoryUsageInMB: 1024 })
  return findInRgba({ data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height })
}
