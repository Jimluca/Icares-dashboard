// Zet factuur-HTML om naar pdf met de ingebouwde browser (geen Word nodig).
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { resourcesDir } from '../bundled'

let background: string | null = null

/** Het briefpapier (logo, oranje lijn, balk onderaan) uit Roberts Word-sjabloon. */
export function letterhead(): string {
  if (background) return background
  const base = resourcesDir()
  background = `data:image/png;base64,${fs.readFileSync(path.join(base, 'briefpapier.png')).toString('base64')}`
  return background
}

export async function htmlToPdf(html: string, file: string): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`)
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, preferCSSPageSize: true })
    fs.writeFileSync(file, pdf)
  } finally {
    win.destroy()
  }
}
