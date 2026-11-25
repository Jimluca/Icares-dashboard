// Ingebouwde kopieën van de scriptbestanden die het dashboard zelf gebruikt
// (SQL-query's, factuursjabloon, mailsjablonen). Zo werkt het dashboard ook op een pc
// waar de SharePoint-map "MT - Documents\Scripts" niet gesynchroniseerd is.
// Staat de SharePoint-map er wel, dan heeft die altijd voorrang.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { loadSettings } from './settings'

/** De map "resources": in het geïnstalleerde programma naast app.asar, tijdens ontwikkeling in de projectmap. */
export function resourcesDir(): string {
  if (app.isPackaged) return process.resourcesPath
  // out/main/index.js -> projectmap/resources
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources')
}

export function bundledDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'bundled') : path.join(resourcesDir(), 'bundled')
}

export interface ResolvedFile {
  path: string
  bundled: boolean
  exists: boolean
}

/** Pad relatief aan de scriptmap, bijv. "IPI-Development\\ipi_sql_scripts\\x.sql". */
export function scriptFile(relative: string): ResolvedFile {
  const shared = path.join(loadSettings().scriptsRoot, relative)
  if (fs.existsSync(shared)) return { path: shared, bundled: false, exists: true }
  const copy = path.join(bundledDir(), relative)
  if (fs.existsSync(copy)) return { path: copy, bundled: true, exists: true }
  return { path: shared, bundled: false, exists: false }
}

/** Map relatief aan de scriptmap; valt terug op de ingebouwde kopie als de SharePoint-map ontbreekt. */
export function scriptDir(relative: string, mustContain: string): string {
  const shared = path.join(loadSettings().scriptsRoot, relative)
  if (fs.existsSync(path.join(shared, mustContain))) return shared
  return path.join(bundledDir(), relative)
}
