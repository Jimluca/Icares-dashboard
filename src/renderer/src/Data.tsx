import { useEffect, useMemo, useState } from 'react'
import type { QueryResult, TunnelState } from '../../shared/ipc'
import { api, unwrap } from './api'
import { Icon, useAction, useToast } from './ui'

export function useTunnel(): TunnelState | null {
  const [state, setState] = useState<TunnelState | null>(null)
  useEffect(() => {
    void api.tunnelState().then(setState)
    return api.onTunnel(setState)
  }, [])
  return state
}

export function TunnelBar() {
  const t = useTunnel()
  const act = useAction()
  if (!t) return null
  const cls = t.open ? 'up' : t.connecting ? 'busy' : 'down'
  return (
    <div className={`tunnel ${cls}`}>
      <span className="dot" />
      <span className="tunnel-text">
        {t.connecting
          ? 'Verbinden met de databaseserver…'
          : t.open
            ? <>Database-tunnel is open{t.localListening ? <> · ook beschikbaar voor losse scripts op <span className="mono">localhost:{t.localPort}</span></> : null}.</>
            : 'Database-tunnel is dicht.'}
        {t.error && <span className="tunnel-error">{t.error}</span>}
      </span>
      {t.open ? (
        <button className="btn btn-sm" onClick={() => void api.tunnelClose()}>
          Sluiten
        </button>
      ) : (
        <button className="btn btn-sm btn-primary" disabled={t.connecting} onClick={() => act(() => unwrap(api.tunnelOpen()), 'Database-tunnel is open.')}>
          Tunnel openen
        </button>
      )}
    </div>
  )
}

export function ResultTable({ result, name, okColumn }: { result: QueryResult; name: string; okColumn?: number }) {
  const [filter, setFilter] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const act = useAction()
  const toast = useToast()
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? result.rows.filter((r) => r.some((v) => String(v ?? '').toLowerCase().includes(q))) : result.rows
  }, [result, filter])
  const shown = rows.slice(0, 500)

  const exportAs = async (format: 'xlsx' | 'tsv'): Promise<void> => {
    const p = await act(() => unwrap(api.exportResult(name, { ...result, rows }, format)))
    if (p) {
      setSaved(p)
      toast('Opgeslagen.')
    }
  }

  return (
    <div className="result">
      <div className="result-bar">
        <span className="strong">
          {result.rows.length} {result.rows.length === 1 ? 'rij' : 'rijen'}
          {filter && ` · ${rows.length} na filter`}
        </span>
        {result.ms > 0 && <span className="muted small">{(result.ms / 1000).toFixed(1)} s</span>}
        {result.truncated && <span className="tag tag-warn">Afgekapt op {result.rows.length} rijen</span>}
        <input className="result-filter" placeholder="Filteren…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn btn-sm" onClick={() => act(() => unwrap(api.copyResult({ ...result, rows })), 'Rijen gekopieerd (zonder kopregel), klaar om in Excel te plakken.')}>
          <Icon name="copy" /> Rijen kopiëren
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void exportAs('xlsx')}>
          Excel
        </button>
        <button className="btn btn-sm" onClick={() => void exportAs('tsv')}>
          TSV
        </button>
      </div>
      {saved && (
        <div className="notice notice-ok">
          Opgeslagen: <span className="mono">{saved}</span>{' '}
          <button className="link-btn" onClick={() => act(() => unwrap(api.openPath(saved)))}>
            Openen
          </button>
        </div>
      )}
      {result.rows.length === 0 ? (
        <p className="muted">Geen resultaten.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {result.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className={okColumn !== undefined ? (r[okColumn] === 'ja' ? '' : 'bad') : ''}>
                  {r.map((v, j) => (
                    <td key={j} title={String(v ?? '')}>
                      {v === null ? <span className="muted">NULL</span> : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && <p className="muted small">Eerste 500 rijen getoond; de export bevat alles.</p>}
        </div>
      )}
    </div>
  )
}
