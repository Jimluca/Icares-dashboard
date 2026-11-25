"""Start de administratie-app (WeFact-automatisering) vanuit het Icares Dashboard.

Omgevingsvariabelen (gezet door het dashboard):
  ICARES_ADMIN_ROOT   map met overzicht\\overzicht (de app) en de gegevens
  ICARES_ADMIN_PORT   poort (standaard 47815)
  ICARES_ADMIN_DEMO   "1" = demomodus:
                        - WeFact-gegevens komen uit demo-wefact.json (live alleen als dat lukt)
                        - opslaan in WeFact en BVKostenBaten bijwerken zijn uitgeschakeld
  ICARES_WEFACT_API   (optioneel) WeFact-sleutel uit de kluis van het dashboard

De app zelf wordt niet aangepast; dit script verandert alleen gedrag tijdens het draaien.
"""
import json
import os
import runpy
import sys
from pathlib import Path

ROOT = Path(os.environ["ICARES_ADMIN_ROOT"])
DEMO = os.environ.get("ICARES_ADMIN_DEMO") == "1"
sys.path.insert(0, str(ROOT / "overzicht"))

from overzicht import config, wefact  # noqa: E402

if DEMO:
    import keyring

    config.CACHEMAP = ROOT / "cache"
    sleutel_uit_kluis = os.environ.get("ICARES_WEFACT_API", "")
    _origineel_ww = keyring.get_password

    def _get_password(service, gebruiker):
        if (service, gebruiker) == config.KEYRING_WEFACT:
            return sleutel_uit_kluis or "demo"
        return _origineel_ww(service, gebruiker)

    keyring.get_password = _get_password

    opname_pad = ROOT / "demo-wefact.json"
    opnames = json.loads(opname_pad.read_text(encoding="utf-8"))["aanroepen"] if opname_pad.exists() else {}
    _origineel = wefact.WeFact.aanroep
    live = {"mag": bool(sleutel_uit_kluis)}

    def _aanroep(self, controller, actie, **params):
        if actie not in wefact.TOEGESTANE_ACTIES:
            raise ValueError(f"Actie '{actie}' is niet toegestaan: dit script leest alleen.")
        if live["mag"]:
            try:
                return _origineel(self, controller, actie, **params)
            except wefact.WeFactFout:
                live["mag"] = False  # bijv. IP niet op de whitelist: verder met de vastlegging
        sleutel = f"{controller}|{actie}|{json.dumps(params, sort_keys=True, default=str)}"
        if sleutel in opnames:
            return opnames[sleutel]
        raise wefact.WeFactFout("Dit gegeven zit niet in de demo.")

    wefact.WeFact.aanroep = _aanroep

    from overzicht.dashboard import wefact_schrijven

    def _geblokkeerd(*_a, **_k):
        raise RuntimeError("Demo: in de demo wordt niets in WeFact opgeslagen.")

    for naam in ("inkoopfactuur", "bijlage", "leverancier", "_aanroep"):
        setattr(wefact_schrijven.WeFactSchrijver, naam, _geblokkeerd)

    from overzicht import main

    def _bouw(_jaar):
        raise wefact.WeFactFout("Demo: BVKostenBaten wordt in de demo niet bijgewerkt.")

    main.bouw = _bouw

from overzicht.dashboard import app as _app  # noqa: E402

_app.POORT = int(os.environ.get("ICARES_ADMIN_PORT", "47815"))
# De app laat alleen verzoeken toe op zijn eigen poort; de (demo)poort dus ook toestaan
_app.TOEGESTANE_HOSTS = set(_app.TOEGESTANE_HOSTS) | {f"127.0.0.1:{_app.POORT}", f"localhost:{_app.POORT}"}
os.chdir(ROOT / "overzicht")
sys.argv = ["overzicht.dashboard"]
runpy.run_module("overzicht.dashboard", run_name="__main__", alter_sys=True)
