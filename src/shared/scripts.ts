// Overzicht van de scripts uit de overdracht van Robert.
// Mappen zijn relatief aan de gedeelde scriptmap:
//   %USERPROFILE%\Icares B.V\MT - Documents\Scripts

export type ScriptKind = 'perl' | 'python' | 'sql' | 'powershell' | 'builtin'

export interface ScriptArg {
  id: string
  label: string
  type: 'file' | 'text' | 'number'
  optional?: boolean
  placeholder?: string
  /** Bestandsextensies voor de bestandskiezer, zonder punt. */
  extensions?: string[]
  /** Voor uitvoerbestanden: de bestandskiezer vraagt om een nieuwe naam. */
  save?: boolean
}

export interface ScriptDef {
  id: string
  title: string
  category: string
  summary: string
  folder: string
  file: string
  kind: ScriptKind
  args?: ScriptArg[]
  /** Het script verwacht een databaseverbinding op localhost:10000 (SSH-tunnel). */
  needsTunnel?: boolean
  /** Waarschuwing die eerst bevestigd moet worden. */
  danger?: string
  steps: string[]
  /** Extra documenten (relatief aan de scriptmap) om te openen. */
  docs?: { label: string; path: string }[]
  /** Benodigdheden, zie src/main/scripts/requirements.ts. */
  requires: string[]
  perlModules?: string[]
  /** Bestanden zijn nog niet aangeleverd. */
  notDelivered?: boolean
}

export const SCRIPTS: ScriptDef[] = [
  // ---------------- IPI-facturatie ----------------
  {
    id: 'ipi-nieuwe-clienten',
    title: 'Nieuwe IPI-cliënten zonder factuur',
    category: 'IPI-facturatie',
    summary: 'Controleert of er nieuwe IPI-cliënten zijn waarvoor nog geen factuur is verstuurd.',
    folder: 'IPI-Development\\ipi_sql_scripts',
    file: 'get_ipi_clients_without_invoice.sql',
    kind: 'sql',
    steps: [
      'Open de database-tunnel (bovenaan deze pagina).',
      'Klik op "Uitvoeren". Het resultaat verschijnt hieronder als tabel.',
      'Staan er cliënten in het resultaat? Maak dan de facturen met het script "IPI-facturen maken en versturen".'
    ],
    requires: ['tunnel']
  },
  {
    id: 'ipi-facturen',
    title: 'IPI-facturen maken en versturen',
    category: 'IPI-facturatie',
    summary: 'Maakt facturen (pdf en Excel) voor nieuwe IPI-cliënten en mailt ze naar de organisatie.',
    folder: 'IPI-Development',
    file: 'ipi_templates\\ipi_factuur_sjabloon.xlsx',
    kind: 'builtin',
    needsTunnel: true,
    danger: 'Buiten de testmodus verstuurt dit echte facturen per e-mail naar klanten en legt het factuurnummers vast in de database.',
    steps: [
      'Klik op "Nieuwe cliënten ophalen". Per organisatie zie je de cliënten zonder IPI-factuur.',
      'Controleer per organisatie het factuuradres en kies de aanhef (meestal de voornaam). Bekijk eventueel een voorbeeldfactuur.',
      'Laat "Testmodus" eerst aan: dan wordt er niets in de database gewijzigd en gaan alle mails alleen naar jouw testadres.',
      'Klopt alles? Zet testmodus uit en klik op "Facturen maken en versturen". De facturen komen direct in SharePoint (facturen <jaar> IPI), de klant krijgt de mail, invoices@ een kopie en facturen@ de ter-info-mail.',
      'De nieuwe facturen worden automatisch toegevoegd aan __openstaande_IPI_facturen.xlsx (tenzij dat bestand open staat; dan kun je de regels kopiëren).'
    ],
    docs: [{ label: 'Documentatie IPI-facturatie-app', path: 'IPI-Development\\ipi_documentatie\\Documentatie_IPI_facturatie_app.docx' }],
    requires: []
  },
  {
    id: 'ipi-status',
    title: 'Status IPI-facturen',
    category: 'IPI-facturatie',
    summary: 'Toont de factuurdatum en status van IPI-cliënten, om het overzicht met openstaande facturen bij te werken.',
    folder: 'IPI-Development\\ipi_sql_scripts',
    file: 'get_ipi_clients_invoice_date.sql',
    kind: 'sql',
    steps: [
      'Open de database-tunnel.',
      'Klik op "Uitvoeren".',
      'Kopieer de nieuwe rijen ("Rijen kopiëren") en plak ze in __openstaande_IPI_facturen.xlsx op SharePoint (map "facturen <jaar> IPI"), of exporteer naar Excel.'
    ],
    requires: ['tunnel']
  },
  {
    id: 'ipi-organisaties',
    title: 'Overzicht IPI-organisaties',
    category: 'IPI-facturatie',
    summary: 'Laat zien welke organisaties IPI afnemen, met alle gegevens.',
    folder: 'IPI-Development\\ipi_sql_scripts',
    file: 'select_all_info_IPI_organizations.sql',
    kind: 'sql',
    steps: ['Open de database-tunnel.', 'Klik op "Uitvoeren". Exporteer eventueel naar Excel.'],
    requires: ['tunnel']
  },
  {
    id: 'ipi-betaald',
    title: 'Betaalde IPI-facturen verwerken',
    category: 'IPI-facturatie',
    summary: 'Zet betaalde IPI-facturen op betaald (PAYED) en haalt ze uit __openstaande_IPI_facturen.xlsx.',
    folder: 'IPI-Development',
    file: '02_ipi_check_for_paid_invoices.pl',
    kind: 'builtin',
    needsTunnel: true,
    steps: [
      'Klik op "Openstaande facturen ophalen". Verlopen facturen (betaaltermijn van 8 dagen voorbij) staan in het rood.',
      'Zoek de factuur op met het nummer uit de bankafschrijving (bijv. IPI0574) en vink hem aan. Je kunt meerdere facturen tegelijk aanvinken.',
      'Klik op "Op betaald zetten". De status in Icares Professional wordt PAYED en de regel verdwijnt uit __openstaande_IPI_facturen.xlsx.',
      'Robert deed dit vroeger met de hand in het notitieveld van de cliënt; dat is nu niet meer nodig.'
    ],
    requires: []
  },

  // ---------------- Cliënten ----------------
  {
    id: 'clienten-verwijderen',
    title: 'Personen beheren',
    category: 'Cliënten',
    summary: 'Zoek een organisatie; zet professionals of managers op non-actief, werk e-mailadressen bij of verwijder personen uit Icares Professional.',
    folder: 'Clienten_verwijderen_htttp_POST_request',
    file: 'delete_client_batches_via_POST_request_from_csv.pl',
    kind: 'builtin',
    needsTunnel: true,
    danger: 'Verwijderen uit Icares Professional is definitief en kan niet ongedaan worden gemaakt.',
    steps: [
      'Typ (een deel van) de naam van de organisatie en kies de juiste.',
      'Je ziet alle organisatiemanagers, professionals en cliënten van die organisatie.',
      'Met ✎ wijzig je het e-mailadres. Met de statusknop zet je een professional of manager op non-actief (of weer actief).',
      'Klik op het kruisje achter een persoon. Na de waarschuwing wordt die persoon via het beheerscherm van Icares Professional verwijderd, net als met de verwijderknop daar.',
      'Het dashboard controleert daarna in de database of de persoon echt weg is.',
      'Eerst proberen? Gebruik "Inloggen testen": dat logt in en zoekt het verwijderformulier, zonder iets te verwijderen.',
      'Alle wijzigingen komen in een logboek op deze pc (link onderaan de lijst).'
    ],
    requires: []
  },
  {
    id: 'fontys-studenten',
    title: 'Fontys-studenten aanmaken als professional',
    category: 'Cliënten',
    summary: 'Maakt Fontys-studenten uit een Excel-bestand aan als professional, direct klaar om in te loggen.',
    folder: 'IcaresImportUsers',
    file: '01_create_insert_clients_sql_script.pl',
    kind: 'builtin',
    needsTunnel: true,
    danger: 'Dit maakt echte accounts aan in Icares Professional en kan bestaande accounts een ander e-mailadres geven (subadres).',
    steps: [
      'Kies het Excel-bestand van Fontys. Kolom A studentnummer, B e-mail, C voornaam, D achternaam, vanaf regel 2.',
      'Controleer de organisatie (standaard 275, IMK) en wie als "aangemaakt door" geldt (standaard 254396, Wouter van Kempen).',
      'Het dashboard toont per student wat er gebeurt: nieuw, overslaan (bestaat al) of subadres (een bestaand account met hetzelfde adres krijgt +client of +manager in het e-mailadres, zoals Robert deed).',
      'Klik op "Accounts aanmaken". Alles gebeurt in één keer; gaat er iets mis, dan wordt niets aangepast. Of maak alleen een SQL-bestand, zoals Robert.',
      'Het beginwachtwoord van een student is het studentnummer achterstevoren (zoals Robert het deed). Studenten kunnen het daarna zelf wijzigen.'
    ],
    requires: []
  },

  // ---------------- Opleidingsdata ----------------
  {
    id: 'edudex-sectoren',
    title: 'EDU-dex sectoren voorspellen',
    category: 'Opleidingsdata',
    summary: 'Importeert EDU-dex-cursussen en voorspelt per cursus de sector op basis van tekstovereenkomst.',
    folder: 'IcaresEdudexSectorPrediction\\Automated_Sector_Assignment\\November_2025',
    file: '01_predict_sectors_string_similarity_based_2025_01_08.pl',
    kind: 'perl',
    needsTunnel: true,
    steps: [
      'Open eerst de database-tunnel.',
      'Klik op "Start". Per opleidingsinstituut verschijnen twee Excel-bestanden: *_predicted_sectors.xlsx en *_all_prediction_info.xlsx.',
      'Laat de voorspellingen nakijken en verwerk de correcties met de SQL-scripts in de submap scripts.',
      'Tip: voor een nieuwe ronde kopieer je de map naar een nieuwe maandmap.'
    ],
    requires: ['perl'],
    perlModules: ['DBI', 'DBD::mysql', 'String::Similarity', 'Statistics::Lite', 'Excel::Writer::XLSX', 'Switch', 'Net::SSH::Perl', 'IO::Prompter', 'Spreadsheet::ParseXLSX', 'Number::Latin', 'Win32::Process::List']
  },
  {
    id: 'linkchecker',
    title: 'Links checken voor (gouden) onderwijsinstellingen',
    category: 'Opleidingsdata',
    summary: 'Controleert met een echte browser of de opleidingslinks van een instelling nog werken.',
    folder: 'Links_checken_gouden_onderwijs',
    file: 'get_education_instance_variants_links.sql',
    kind: 'builtin',
    steps: [
      'Kies de onderwijsinstelling (de lijst komt uit get_education_instance_variants_links.sql) en klik op "Links ophalen". Dit gebruikt de database-tunnel.',
      'Of: kies een .txt-bestand met links (één per regel). Daarvoor is geen tunnel nodig.',
      'Klik op "Links controleren". Het dashboard opent elke link in een onzichtbare browser.',
      'Exporteer het resultaat naar Excel. Rood = link werkt niet (404, time-out of fout).'
    ],
    requires: []
  },

  // ---------------- Rapportages ----------------
  {
    id: 'jaarrapportages',
    title: 'Jaar- en kwartaalrapportages Icares Study',
    category: 'Rapportages',
    summary: 'Maakt de cijfers en grafiekbestanden voor de jaar- of kwartaalrapportage van een gouden klant.',
    folder: 'IcaresOptIns',
    file: '02_process_registrations_via_database_NIEUW.pl',
    kind: 'perl',
    needsTunnel: true,
    steps: [
      'Open eerst de database-tunnel.',
      'Klik op "Start" en kies in het terminalvenster het kwartaal en de onderwijsinstelling.',
      'De bestanden komen in de mappen Registrations, StudyChoiceTest en Graphs van die instelling.',
      'Werk de koppelingen bij: draai in elk Excel-bestand in Graphs de macro UpdateLink, en daarna in het Word-rapport (Alt+F8) de macro UpdateLinksInWord.',
      'Zie het document met de volledige uitleg.'
    ],
    docs: [{ label: 'Uitleg jaarrapportages (Word)', path: 'IcaresOptIns\\Hoe maak ik de jaarrapportages of kwartaalrapportages nieuwe stijl.docx' }],
    requires: ['perl', 'excel', 'word'],
    perlModules: ['DBI', 'DBD::mysql', 'DateTime', 'List::MoreUtils', 'Win32::OLE', 'Win32::Process::List', 'Excel::Writer::XLSX', 'IO::Prompter', 'Date::Parse']
  }
]

/** Onderdelen van het dashboard met een eigen recht (naast de scripts). */
export const MODULES: { id: string; title: string; summary: string }[] = [
  { id: 'administratie', title: 'Administratie (WeFact)', summary: 'Bank, inkoop, verkoop, kasboek en BVKostenBaten.' }
]

export const SCRIPT_CATEGORIES = [...new Set(SCRIPTS.map((s) => s.category))]
