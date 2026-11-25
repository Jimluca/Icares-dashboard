// Vaste plekken op de pc. Werkt zowel binnen Electron als in losse Node-scripts.
import os from 'node:os'
import path from 'node:path'

export function appDataDir(): string {
  const base = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(base, 'IcaresDashboard')
}

export function localDataDir(): string {
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  return path.join(base, 'IcaresDashboard')
}

export function vaultPath(): string {
  return process.env.ICARES_VAULT ?? path.join(appDataDir(), 'vault.json')
}

export function settingsPath(): string {
  return process.env.ICARES_SETTINGS ?? path.join(appDataDir(), 'settings.json')
}

/** Standaard scriptmap: de gesynchroniseerde SharePoint-bibliotheek "MT - Documents". */
export function defaultScriptsRoot(): string {
  return path.join(os.homedir(), 'Icares B.V', 'MT - Documents', 'Scripts')
}
