import { useCallback, useEffect, useState } from 'react'
import type { DbConfigView } from '../../shared/ipc'
import { api, unwrap } from './api'
import { TunnelBar } from './Data'
import { useAction } from './ui'

/** Beheer > Database-koppeling: welke kluisitems de tunnel en database gebruiken. */
export function DbSettings() {
  const [cfg, setCfg] = useState<DbConfigView | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const act = useAction()

  const load = useCallback(async () => {
    const c = await act(() => unwrap(api.dbConfig()))
    if (c) setCfg(c)
  }, [act])

  useEffect(() => {
    void load()
  }, [load])

  if (!cfg) return null
  const keyEntry = cfg.candidates.find((c) => c.id === cfg.tunnelEntryId)

  const save = async (tunnelEntryId: string | null, dbEntryId: string | null): Promise<void> => {
    await act(() => unwrap(api.setDbConfig(tunnelEntryId, dbEntryId)), 'Opgeslagen.')
    void load()
  }

  return (
    <div className="stack">
      <p className="muted">
        De database-tunnel logt met een SSH-sleutel in op de server en daarna met de databasegebruiker op MySQL. Beide staan versleuteld in de kluis. Een admin kan de tunnel alleen gebruiken met toegang tot de groepen waar deze twee items in staan.
      </p>

      {cfg.problems.length > 0 ? (
        <div className="notice notice-warn">
          <strong>Nog niet klaar:</strong>
          <ul className="plain">
            {cfg.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="notice notice-ok">Alles staat klaar. Test hieronder de verbinding.</div>
      )}

      <div className="card stack">
        <label className="field">
          <span>Kluisitem met de SSH-sleutel (de passphrase staat in het wachtwoordveld)</span>
          <select value={cfg.tunnelEntryId ?? ''} onChange={(e) => void save(e.target.value || null, cfg.dbEntryId)}>
            <option value="">Kies…</option>
            {cfg.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.groupName}){c.hasPrivateKey ? ' · sleutel aanwezig' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="row-wrap">
          <span className={`pill ${keyEntry?.hasPrivateKey ? 'pill-ok' : 'pill-nok'}`}>{keyEntry?.hasPrivateKey ? 'SSH-sleutel staat in de kluis' : 'Nog geen SSH-sleutel'}</span>
          <button
            className="btn btn-sm btn-primary"
            disabled={!cfg.tunnelEntryId}
            onClick={async () => {
              const ok = await act(() => unwrap(api.importSshKey(cfg.tunnelEntryId!)))
              if (ok) {
                await load()
                setTestResult(null)
              }
            }}
          >
            SSH-sleutel importeren…
          </button>
          <span className="muted small">Kies het bestand id_rsa (zonder .pub). Daarna kun je het bestand van de pc verwijderen.</span>
        </div>

        <label className="field">
          <span>Kluisitem met de databasegebruiker en het wachtwoord</span>
          <select value={cfg.dbEntryId ?? ''} onChange={(e) => void save(cfg.tunnelEntryId, e.target.value || null)}>
            <option value="">Kies…</option>
            {cfg.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.groupName})
              </option>
            ))}
          </select>
        </label>
      </div>

      <TunnelBar />
      <div className="row-wrap">
        <button
          className="btn"
          disabled={cfg.problems.length > 0 || testing}
          onClick={async () => {
            setTesting(true)
            setTestResult(null)
            const r = await act(() => unwrap(api.testDb()))
            setTesting(false)
            if (r) setTestResult(r)
          }}
        >
          {testing ? 'Testen…' : 'Verbinding testen'}
        </button>
        {testResult && <span className="ok-text">{testResult}</span>}
      </div>
    </div>
  )
}
