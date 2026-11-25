// Instellingen per pc (geen geheimen).
import fs from 'node:fs'
import path from 'node:path'
import { defaultScriptsRoot, settingsPath } from './paths'
import { defaultAdminRoot } from './administratie'

export interface Settings {
  scriptsRoot: string
  adminRoot: string
  tunnel: {
    host: string
    user: string
    localPort: number
    remotePort: number
    database: string
  }
  /** Vingerafdrukken van servers die we eerder vertrouwd hebben (host -> sha256). */
  knownHosts: Record<string, string>
}

export function defaultSettings(): Settings {
  return {
    scriptsRoot: defaultScriptsRoot(),
    adminRoot: defaultAdminRoot(),
    tunnel: {
      host: 'platform.icares.com',
      user: 'icaresdba',
      localPort: 10000,
      remotePort: 3306,
      database: 'icares'
    },
    knownHosts: {}
  }
}

export function loadSettings(): Settings {
  const d = defaultSettings()
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<Settings>
    return { ...d, ...s, tunnel: { ...d.tunnel, ...(s.tunnel ?? {}) }, knownHosts: { ...(s.knownHosts ?? {}) } }
  } catch {
    return d
  }
}

export function saveSettings(s: Omit<Settings, 'knownHosts'> & { knownHosts?: Record<string, string> }): Settings {
  const clean: Settings = {
    scriptsRoot: String(s.scriptsRoot).trim(),
    adminRoot: String(s.adminRoot ?? defaultAdminRoot()).trim(),
    tunnel: {
      host: String(s.tunnel.host).trim(),
      user: String(s.tunnel.user).trim(),
      localPort: Number(s.tunnel.localPort) || 10000,
      remotePort: Number(s.tunnel.remotePort) || 3306,
      database: String(s.tunnel.database ?? 'icares').trim() || 'icares'
    },
    knownHosts: s.knownHosts ?? loadSettings().knownHosts
  }
  if (!/^[A-Za-z0-9.-]+$/.test(clean.tunnel.host) || !/^[A-Za-z0-9._-]+$/.test(clean.tunnel.user) || !/^[A-Za-z0-9_]+$/.test(clean.tunnel.database)) {
    throw new Error('Ongeldige servernaam of gebruikersnaam voor de tunnel.')
  }
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(clean, null, 2), 'utf8')
  return clean
}
