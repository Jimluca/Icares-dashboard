"""Legt de LEES-aanroepen naar WeFact vast voor een demopakket (er wordt niets in WeFact gewijzigd).

Gebruik: python icares_vastleggen.py <map met overzicht\\overzicht> <uitvoerbestand.json>
Draait met de WeFact-sleutel uit de Windows-wachtwoordkluis van deze pc, net als de app zelf.
"""
import json
import sys
import time
from datetime import date

app_dir, uit = sys.argv[1], sys.argv[2]
sys.path.insert(0, app_dir)
from overzicht import main, wefact  # noqa: E402
from overzicht.dashboard.wefact_bron import Bron  # noqa: E402

opnames = {}
_origineel = wefact.WeFact.aanroep


def _opnemen(self, controller, actie, **params):
    if actie not in wefact.TOEGESTANE_ACTIES:
        raise RuntimeError(f"Vastleggen weigert {controller}.{actie}: alleen lezen is toegestaan.")
    antwoord = _origineel(self, controller, actie, **params)
    opnames[f"{controller}|{actie}|{json.dumps(params, sort_keys=True, default=str)}"] = antwoord
    return antwoord


wefact.WeFact.aanroep = _opnemen

main.bereken(date.today().year)
print("STAP cijfers", flush=True)
bron = Bron()
bron.kostencategorieen()
leveranciers = bron.leveranciers()
bron.recente_inkoop()
print(f"STAP inkoop {len(leveranciers)}", flush=True)
for lev in leveranciers:
    try:
        bron.boekingsregels(lev["id"])
    except Exception:  # noqa: BLE001 - een enkele leverancier mag ontbreken
        pass
    time.sleep(0.15)
print("STAP boekingsregels", flush=True)
with open(uit, "w", encoding="utf-8") as f:
    json.dump({"vastgelegd": time.strftime("%Y-%m-%d %H:%M"), "aanroepen": opnames}, f, ensure_ascii=False)
print(f"KLAAR {len(opnames)}", flush=True)
