# Icares Dashboard

Intern Windows-programma met de overdracht van Robert: een versleutelde wachtwoordkluis (met 2FA-codes) en zijn scripts. Inloggen gaat alleen met een wachtwoord, met twee rollen: **super admin** en **admin**.

> Status: lokale ontwikkelversie. Er is nog geen installer, en er is nog geen update-bestand om de kluis naar collega's te sturen.

## Starten

Dubbelklik op `Dashboard starten.cmd`, of:

```powershell
npm run start
```

De tijdelijke inlogwachtwoorden staan in `dev-credentials.local.txt`. Die worden niet gedeeld en staan in `.gitignore`.

## Waar staat wat

| | Plek |
|---|---|
| Kluis (versleuteld) | `%APPDATA%\IcaresDashboard\vault.json`, met de vorige versie als `vault.json.bak` |
| Instellingen per pc | `%APPDATA%\IcaresDashboard\settings.json` |
| Scripts | SharePoint `MT - Documents\Scripts`, standaard `%USERPROFILE%\Icares B.V\MT - Documents\Scripts` |
| Python-omgeving linkchecker | `%LOCALAPPDATA%\IcaresDashboard\venvs\linkchecker`, per pc en niet in SharePoint |

## Ontwerp in het kort

- **Kluis** (`src/main/vault`)
  - Elke wachtwoordgroep heeft een eigen AES-256-GCM-sleutel.
  - Elke gebruiker heeft een X25519-sleutelpaar. De privésleutel is versleuteld met het wachtwoord (scrypt).
  - De super admin "verzegelt" groepssleutels voor een admin. Een admin zonder sleutel van een groep kan die groep dus echt niet openen, ook niet door met bestanden te knutselen.
- **Rechten**
  - Per groep en per script.
  - Het hoofdproces controleert elke aanvraag, dus de schermen alleen verbergen is niet genoeg om iets te openen.
- **Veiligheid tijdens gebruik**
  - Na 10 minuten zonder activiteit vergrendelt het programma automatisch.
  - Het klembord wordt 30 seconden na kopiëren gewist.
  - Na herhaalde foute pogingen moet je even wachten voordat je opnieuw kunt inloggen.
- **Scripts** (`src/shared/scripts.ts`)
  - Er is een catalogus met per script de stappen uit de overdracht.
  - **Start** opent een terminalvenster in de scriptmap.
  - Het dashboard kan een database-tunnel openen met Windows-ssh, als vervanging van Babun.
  - De pagina "Deze pc" controleert wat er geïnstalleerd is en installeert ontbrekende onderdelen.

## Administratie

Het menu **Administratie** toont de bestaande administratie-app (map `Wefact automatisering`, Python/Flask op `127.0.0.1:47815`) in het dashboard en start die als hij nog niet draait. Alleen gebruikers met het recht "Administratie (WeFact)" zien het. Op een nieuwe pc biedt het dashboard `installeren.bat` aan.

## Kluis opnieuw vullen uit de overdracht

```powershell
npm run seed -- "<map Overdracht RObert>" "<scriptmap>" --force
```

## Testen

```powershell
npm test
```

```powershell
npm run e2e
```

`npm test` test de versleuteling, de rechten en 2FA. `npm run e2e` start het echte programma op een kopie van de kluis en controleert inloggen, de rechten van super admin en admin, de scripts en "Deze pc".

## Op een andere pc verder werken

1. Installeer [Node.js](https://nodejs.org) (LTS) en [Git](https://git-scm.com).
2. `git clone https://github.com/Jimluca/Icares-dashboard.git`, dan in de map `npm install`.
3. `npm run dev` start het dashboard. Zonder kluis vraagt het om een kluis te importeren (op de werk-pc: Beheer > Kluis exporteren). De kluis en `dev-credentials.local.txt` staan **niet** in git.
4. Alleen nodig voor `npm run dist` (installer met ingebouwde administratie): de map `build/python`, die niet in git staat.
   - Pak `python-3.12.10-embed-amd64.zip` (python.org) uit naar `build/python`.
   - Zet in `build/python/python312._pth` de regels `python312.zip`, `.`, `Lib\site-packages` en `import site`.
   - Met een gewone Python 3.12: `pip install --target build/python/Lib/site-packages -r build/requirements-administratie.txt`.

## Nog te doen

- Update-bestand om kluiswijzigingen naar collega's te sturen (de installer bestaat al)
- Definitieve wachtwoorden per collega aanmaken
- Prijslijsten
- Overige Perl-scripts inbouwen: EDU-dex, jaarrapportages
