// Fontys-studenten aanmaken als professional (Roberts 01_create_insert_clients_sql_script.pl).

export interface FontysSettings {
  organizationId: number // standaard 275 (IMK)
  createdBy: number // organisatiemanager, standaard 254396 (Wouter van Kempen)
  countryRegionId: number
  countryId: number
  languageId: number
}

export const FONTYS_DEFAULTS: FontysSettings = {
  organizationId: 275,
  createdBy: 254396,
  countryRegionId: 2, // Nederland (NL)
  countryId: 158, // Nederland
  languageId: 20 // Nederlands
}

export interface FontysRow {
  row: number // regelnummer in Excel
  studentNr: string
  email: string
  firstname: string
  lastname: string
}

export type FontysAction =
  | 'nieuw' // wordt aangemaakt
  | 'subadres' // bestaand account krijgt +rol in het e-mailadres, daarna nieuw account
  | 'bestaat' // er is al een professional met dit adres bij deze organisatie: overslaan
  | 'fout' // regel klopt niet (zie message)

export interface FontysPlanRow extends FontysRow {
  action: FontysAction
  message: string
  existing?: { id: number; role: string; organizationId: number | null; newEmail?: string }
}

export interface FontysPlan {
  settings: FontysSettings
  organizationName: string
  createdByName: string
  rows: FontysPlanRow[]
  file: string
}

export interface FontysResult {
  created: number
  readdressed: number
  sqlFile?: string
}
