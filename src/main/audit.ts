// Logboek van wijzigingen in Icares Professional (wie, wanneer, wat), per pc.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localDataDir } from './paths'

export function auditFile(): string {
  return path.join(localDataDir(), 'logs', 'wijzigingen-personen.csv')
}

const cell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`

export function audit(who: string, action: string, userId: number, details: string): void {
  const file = auditFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file)) fs.writeFileSync(file, '﻿tijd;dashboardgebruiker;pc;actie;user-id;details\r\n', 'utf8')
  const line = [new Date().toISOString(), who, os.hostname(), action, userId, details].map(cell).join(';')
  fs.appendFileSync(file, `${line}\r\n`, 'utf8')
}
