// IPI-facturatie: gedeelde types en rekenregels (zelfde uitkomsten als Roberts 01_ipi_make_invoices.pl).

export interface IpiClient {
  userId: number
  firstname: string
  middlename: string
  lastname: string
  email: string
}

export interface IpiOrg {
  orgId: number
  /** Naam in de database. */
  name: string
  /** Naam op de factuur (kan afwijken, zie INVOICE_NAME_OVERRIDES). */
  invoiceName: string
  billingEmail: string
  contactPerson: string
  salutations: string[]
  addressLine: string
  postalCityLine: string
  debNr: string
  priceExcl: number
  clients: IpiClient[]
  /** Redenen waarom deze organisatie nu niet gefactureerd kan worden. */
  problems: string[]
}

export interface IpiPreview {
  orgs: IpiOrg[]
  nextInvoiceNr: number
  invoiceFolder: string
  invoiceFolderExists: boolean
}

export interface IpiSendOptions {
  orgId: number
  /** User-id's die de gebruiker in het scherm zag; moet nog steeds kloppen bij versturen. */
  userIds: number[]
  billingEmail: string
  salutation: string
  test: boolean
  testAddress: string
}

export interface IpiInvoiceFile {
  nr: string // bijv. 0575
  userId: number
  pdf: string
  xlsx: string
}

export interface IpiSendResult {
  runId: string
  test: boolean
  orgName: string
  invoices: IpiInvoiceFile[]
  mailed: boolean
  log: string[]
  warnings: string[]
  overviewRows: { columns: string[]; rows: (string | number | null)[][] }
}

export interface OpenInvoice {
  nr: string // "0574"
  userId: number
  date: string // jjjj-mm-dd
  expired: boolean // betaaltermijn (8 dagen) verstreken
  totalIncl: number
  firstname: string
  middlename: string
  lastname: string
  email: string
  orgId: number
  orgName: string
}

export interface MarkPaidResult {
  updated: number
  overviewRemoved: number
  warnings: string[]
}

export interface IpiConfig {
  /** Ontvangers van de "ter info"-mail. */
  infoRecipients: string[]
  /** Aanhef in de "ter info"-mail. */
  infoSalutation: string
  /** Adres waar in testmodus alle mails heen gaan. */
  testAddress: string
  smtpEntryId?: string
  imapEntryId?: string
  moveImapMails: boolean
  appendOverview: boolean
}

export const DEFAULT_IPI_CONFIG: IpiConfig = {
  infoRecipients: ['facturen@icares.nl', 'dropbox@36404337.icares.highrisehq.com'],
  infoSalutation: 'Karin en Mila',
  testAddress: '',
  moveImapMails: true,
  appendOverview: true
}

/** Organisaties met een andere naam op de factuur (uit Roberts script). */
export const INVOICE_NAME_OVERRIDES: Record<number, string> = {
  291: 'Schaper Vizie' // Doen Vanuit Zijn
}

export const BTW_FACTOR = 1.21
export const MAX_INVOICES_PER_MAIL = 5

/** 575 -> "0575" */
export function padNr(nr: number): string {
  return String(nr).padStart(4, '0')
}

export function dmy(d: Date, sep = '/'): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getDate())}${sep}${p(d.getMonth() + 1)}${sep}${d.getFullYear()}`
}

export function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "IPI0575-24/11/2026", zoals op de factuur. */
export function displayInvoiceNr(nr: number, date: Date): string {
  return `IPI${padNr(nr)}-${dmy(date)}`
}

/** "M.S. (user-id: 280105)": alleen initialen i.v.m. privacy (verzoek LVCoaching). */
export function clientLabel(c: { firstname: string; lastname: string; userId: number }): string {
  const first = (s: string): string => (s ?? '').trim().charAt(0)
  return `${first(c.firstname)}.${first(c.lastname)}. (user-id: ${c.userId})`
}

/** "Jan de Vries" -> ["Jan", "Jan de", "Jan de Vries"]  (Roberts keuzemenu voor de aanhef). */
export function salutationOptions(contactPerson: string): string[] {
  const parts = (contactPerson ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.map((_, i) => parts.slice(0, i + 1).join(' '))
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function amounts(priceExcl: number): { excl: number; btw: number; total: number } {
  const excl = round2(priceExcl)
  const btw = round2(excl * 0.21)
  return { excl, btw, total: round2(excl + btw) }
}

export function euro(n: number): string {
  return n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Bestandsnaam zoals Robert: IPI0574Hehamahua23112026 (zonder extensie). */
export function invoiceBaseName(nr: number, orgName: string, date: Date): string {
  const safeOrg = orgName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()
  return `IPI${padNr(nr)}${safeOrg}${dmy(date, '')}`
}

/** De tekst die Robert aan het notitieveld van de cliënt toevoegde. */
export function notesSuffix(nr: number, date: Date): string {
  return `\n<IPIFacNr>${padNr(nr)}</IPIFacNr>\n<IPIFacDate>${ymd(date)}</IPIFacDate>\n<IPIFacStatus>OPEN</IPIFacStatus>`
}

export function isEmail(s: string): boolean {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s.trim())
}
