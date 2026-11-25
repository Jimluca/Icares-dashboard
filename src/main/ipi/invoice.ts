// De factuur zelf: HTML voor de pdf (zelfde opmaak als Roberts Word-sjabloon)
// en een Excel-kopie op basis van Roberts Excel-sjabloon.
import ExcelJS from 'exceljs'
import { amounts, clientLabel, displayInvoiceNr, dmy, euro, type IpiClient, type IpiOrg } from '../../shared/ipi'

export interface InvoiceData {
  org: IpiOrg
  client: IpiClient
  nr: number
  date: Date
  test: boolean
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** HTML van één A4-factuur. `background` is een data-URL van het briefpapier. */
export function invoiceHtml(d: InvoiceData, background: string): string {
  const a = amounts(d.org.priceExcl)
  const nr = d.test ? `TEST-${displayInvoiceNr(d.nr, d.date)}` : displayInvoiceNr(d.nr, d.date)
  const datum = dmy(d.date, '-')
  const money = (n: number, bold = false): string => `<span class="eur${bold ? ' b' : ''}">€</span><span class="amt${bold ? ' b' : ''}">${euro(n)}</span>`
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>${esc(nr)}</title>
<style>
  @page { size: A4; margin: 0 }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { width: 210mm; height: 297mm }
  body { position: relative; font-family: Verdana, Geneva, sans-serif; font-size: 9pt; color: #000;
         background: url('${background}') no-repeat 0 0 / 210mm 297mm }
  .abs { position: absolute }
  .addr { left: 26mm; top: 41mm; font-weight: bold; font-size: 11pt; line-height: 1.38 }
  .title { left: 26mm; top: 72mm; font-weight: bold; font-size: 13pt; text-decoration: underline }
  .meta { left: 60mm; top: 82.5mm; line-height: 1.55 }
  .meta td { padding: 0 } .meta td:first-child { text-align: right; padding-right: 2mm; width: 48mm }
  .head { left: 24mm; top: 105mm; width: 157mm; height: 5.6mm; border: 1px solid #000; font-weight: bold; font-size: 9pt }
  .head span { position: absolute; top: 0.9mm }
  .l1 { left: 26mm; top: 115mm; font-weight: bold }
  .l2 { left: 26mm; top: 123.5mm }
  .l3 { left: 26mm; top: 137.5mm; font-weight: bold }
  .eur { position: absolute; left: 0 } .amt { position: absolute; right: 0 }
  .money { width: 26mm; height: 5mm; left: 138mm }
  .b { font-weight: bold }
  .rule { left: 24mm; width: 157mm; border-top: 1px solid #000 }
  .tot { left: 26mm }
  .totbox { left: 24mm; top: 227.3mm; width: 157mm; height: 5.2mm; border: 1px solid #000 }
  .pay { left: 26mm; top: 241mm; width: 100mm; line-height: 1.25 }
  .foot { font-family: Calibri, 'Segoe UI', sans-serif; font-size: 8.5pt; line-height: 1.5; top: 264mm }
  .stamp { left: 30mm; top: 160mm; font-size: 40pt; color: rgba(200,30,30,.18); transform: rotate(-24deg); font-weight: bold; letter-spacing: 2mm }
</style></head>
<body>
  <div class="abs addr">${esc(d.org.invoiceName)}<br>t.a.v. crediteurenadministratie<br>${esc(d.org.addressLine)}<br>${esc(d.org.postalCityLine)}</div>
  <div class="abs title">Factuur</div>
  <table class="abs meta">
    <tr><td>Debiteurnummer :</td><td>D${esc(d.org.debNr)}</td></tr>
    <tr><td>Factuurnummer :</td><td>${esc(nr)}</td></tr>
    <tr><td>Factuurdatum :</td><td>${datum}</td></tr>
  </table>
  <div class="abs head"><span style="left:1.5mm">Omschrijving</span><span style="left:86.5mm">Periode</span><span style="left:105mm">Tot</span><span style="left:113.5mm">Nettobedrag</span></div>
  <div class="abs l1">Icares Professional Individual voor:</div>
  <div class="abs l2">Cliënt initialen: ${esc(clientLabel(d.client))}</div>
  <div class="abs l3">Icares Professional Individual:</div>
  <div class="abs money" style="top:137.5mm">${money(a.excl)}</div>
  <div class="abs rule" style="top:209mm"></div>
  <div class="abs tot" style="top:210.3mm">Totaalbedrag exclusief BTW</div>
  <div class="abs money" style="top:210.3mm">${money(a.excl)}</div>
  <div class="abs tot" style="top:218.4mm">Totaal BTW-bedrag 21%</div>
  <div class="abs money" style="top:218.4mm">${money(a.btw)}</div>
  <div class="abs rule" style="top:223.3mm"></div>
  <div class="abs totbox"></div>
  <div class="abs tot b" style="top:227.8mm">Totaal te voldoen</div>
  <div class="abs money" style="top:227.8mm">${money(a.total, true)}</div>
  <div class="abs pay">Betaling binnen 7 dagen na factuurdatum o.v.v. debiteur- en factuurnummer.</div>
  <div class="abs foot" style="left:25mm">Icares B.V.<br>Schimmelt 26<br>5611 ZX Eindhoven</div>
  <div class="abs foot" style="left:79mm;width:50mm;text-align:center">e-mail: info@icares.nl<br>tel: +31402395590<br>icares.com</div>
  <div class="abs foot" style="right:28mm;text-align:right">Rabobank 15.12.34.434<br><i>IBAN</i> NL63 RABO 0151 2344 34<br><i>BIC</i> RABONL2U</div>
  <div class="abs foot" style="top:281.5mm;left:0;width:210mm;text-align:center;font-size:8pt">Handelsregister K.v.K. 18086033&nbsp;&nbsp;&nbsp; BTW-nummer NL8173.34.257.B01</div>
  ${d.test ? '<div class="abs stamp">TESTFACTUUR</div>' : ''}
</body></html>`
}

/** Vult Roberts Excel-sjabloon (zelfde cellen als zijn script) en slaat het op als `file`. */
export async function writeInvoiceXlsx(templateFile: string, file: string, d: InvoiceData): Promise<void> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(templateFile)
  const ws = wb.worksheets[0]
  const a = amounts(d.org.priceExcl)
  ws.getCell('A1').value = d.org.invoiceName
  ws.getCell('A3').value = d.org.addressLine
  ws.getCell('A4').value = d.org.postalCityLine
  ws.getCell('B10').value = `D${d.org.debNr}`
  ws.getCell('B11').value = (d.test ? 'TEST-' : '') + displayInvoiceNr(d.nr, d.date)
  ws.getCell('B12').value = new Date(Date.UTC(d.date.getFullYear(), d.date.getMonth(), d.date.getDate()))
  ws.getCell('B12').numFmt = 'dd-mm-yyyy'
  ws.getCell('A19').value = `Cliënt initialen: ${clientLabel(d.client)}`
  ws.getCell('D22').value = a.excl
  ws.getCell('D38').value = { formula: 'SUM(D16:D36)', result: a.excl }
  ws.getCell('D40').value = { formula: 'D38*21%', result: a.btw }
  ws.getCell('D42').value = { formula: 'SUM(D38:D40)', result: a.total }
  wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true }
  await wb.xlsx.writeFile(file)
}
