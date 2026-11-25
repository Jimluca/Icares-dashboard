// Voegt nieuwe facturen toe aan __openstaande_IPI_facturen.xlsx (stap D uit Roberts handleiding).
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { localDataDir } from '../paths'

export const OVERVIEW_FILE = '__openstaande_IPI_facturen.xlsx'
export const OVERVIEW_COLUMNS = ['IPIFacNr', 'IPIPrice', 'user id', 'IPIFacDate', 'ToPayOrNotToPay', 'IPIFacStatus', 'voornaam', 'achternaam', 'email', 'org-id', 'organisatie']

export type OverviewRow = [number, number, number, Date, string, string, string, string, string, number, string]

/** Is het bestand nu geopend in Excel (Excel maakt dan een ~$-slotbestand)? */
export function isOpenInExcel(file: string): boolean {
  return fs.existsSync(path.join(path.dirname(file), `~$${path.basename(file)}`))
}

export async function appendOverview(file: string, rows: OverviewRow[]): Promise<void> {
  if (!fs.existsSync(file)) throw new Error(`Overzicht niet gevonden: ${file}`)
  if (isOpenInExcel(file)) throw new Error(`${OVERVIEW_FILE} is geopend in Excel (bij jou of een collega). Sluit het en voeg de regels later toe met "Rijen kopiëren".`)
  // Eerst een reservekopie, voor het geval dat
  const backupDir = path.join(localDataDir(), 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  fs.copyFileSync(file, path.join(backupDir, `${Date.now()}_${OVERVIEW_FILE}`))

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  const header = (ws.getRow(1).values as unknown[]).slice(1).map(String)
  if (OVERVIEW_COLUMNS.some((c, i) => header[i] !== c)) {
    throw new Error(`De kolommen van ${OVERVIEW_FILE} zijn veranderd; het dashboard voegt daarom niets toe. Gebruik "Rijen kopiëren".`)
  }
  let last = 1
  ws.eachRow((row, nr) => {
    if (row.getCell(1).value !== null && row.getCell(1).value !== undefined && row.getCell(1).value !== '') last = nr
  })
  rows.forEach((r, i) => {
    const row = ws.getRow(last + 1 + i)
    r.forEach((v, j) => (row.getCell(j + 1).value = v))
    row.getCell(4).numFmt = 'mm-dd-yy'
    row.commit()
  })
  await wb.xlsx.writeFile(file)
}
