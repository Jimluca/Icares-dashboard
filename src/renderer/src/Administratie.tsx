import { useCallback, useEffect, useState } from 'react'
import type { AdminAppStatus } from '../../shared/ipc'
import { api, unwrap } from './api'
import { Modal, useAction, useToast } from './ui'

/** De administratie-app (WeFact-automatisering) binnen het dashboard: echt of als demo. */
export function Administratie() {
  const [st, setSt] = useState<AdminAppStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [frameKey, setFrameKey] = useState(0)
  const [isSuper, setIsSuper] = useState(false)
  const [making, setMaking] = useState<string[] | null>(null)
  const act = useAction()
  const toast = useToast()

  const boot = useCallback(async () => {
    setError(null)
    const s = await api.adminStatus()
    if (!s.ok) return setError(s.error)
    setSt(s.value)
    if (s.value.running || s.value.mode === 'geen') return
    setStarting(true)
    const r = await api.adminStart()
    setStarting(false)
    if (r.ok) {
      setSt(r.value)
      setFrameKey((k) => k + 1)
    } else setError(r.error)
  }, [])

  useEffect(() => {
    void boot()
    void api.session().then((s) => setIsSuper(s?.role === 'superadmin'))
    return api.onAdminProgress((line) => setMaking((m) => (m ? [...m, line] : m)))
  }, [boot])

  const openDemo = async (): Promise<void> => {
    const ok = await act(() => unwrap(api.adminOpenDemo()))
    if (ok) {
      toast('Demopakket geopend.')
      await boot()
    }
  }

  const makeDemo = async (): Promise<void> => {
    setMaking([])
    const r = await act(() => unwrap(api.adminMakeDemo()))
    if (r) {
      setMaking((m) => [...(m ?? []), `Demopakket staat in: ${r}`])
    } else setMaking(null)
  }

  const progressModal = making && (
    <Modal title="Demopakket maken" onClose={() => setMaking(null)}>
      <ul className="log">{making.length === 0 ? <li>Map kiezen…</li> : making.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <p className="muted small">Dit duurt een paar minuten: alle gegevens worden één keer uit WeFact gelezen (er wordt niets gewijzigd). Het pakket bevat financiële gegevens; verwijder het na de demo.</p>
    </Modal>
  )

  if (error && !st?.running) {
    return (
      <div className="page stack">
        <h1>Administratie</h1>
        <div className="notice notice-danger">{error}</div>
        <div className="row-wrap">
          <button className="btn" onClick={() => void boot()}>
            Opnieuw proberen
          </button>
          <button className="btn" onClick={() => void openDemo()}>
            Demopakket openen…
          </button>
        </div>
      </div>
    )
  }
  if (!st || starting) {
    return (
      <div className="page">
        <h1>Administratie</h1>
        <p className="muted">{starting ? `De ${st?.mode === 'demo' ? 'demo-' : ''}administratie wordt gestart… (dit duurt een paar seconden)` : 'Controleren…'}</p>
      </div>
    )
  }
  if (st.mode === 'geen') {
    return (
      <div className="page stack">
        <h1>Administratie</h1>
        <div className="notice notice-warn">Op deze pc staat geen administratie.</div>
        <ul className="plain">
          <li>
            <strong>Demo laten zien?</strong> Maak op de pc met de echte administratie een demopakket (Administratie &gt; Demopakket maken…) en open dat hier.
          </li>
          <li>
            <strong>Echte administratie?</strong> Synchroniseer de gedeelde map "Wefact automatisering" en stel hem in bij <strong>Deze pc</strong>.
          </li>
        </ul>
        <div className="row-wrap">
          <button className="btn btn-primary" onClick={() => void openDemo()}>
            Demopakket openen…
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="admin-app">
      <div className={`admin-bar ${st.mode === 'demo' ? 'is-demo' : ''}`}>
        <strong>Administratie</strong>
        {st.mode === 'demo' ? (
          <span className="small">
            <span className="demo-tag">DEMO</span> cijfers van {st.snapshot || 'de momentopname'} · WeFact-gegevens van {st.recorded || '?'} · er wordt niets opgeslagen in WeFact of BVKostenBaten
          </span>
        ) : (
          <span className="muted small">WeFact · BVKostenBaten · draait lokaal op deze pc</span>
        )}
        <span className="bar-actions">
          {isSuper && st.canMakeDemo && (
            <button className="btn btn-sm" onClick={() => void makeDemo()}>
              Demopakket maken…
            </button>
          )}
          {st.mode === 'demo' && (
            <button className="btn btn-sm" onClick={() => void openDemo()}>
              Ander demopakket…
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setFrameKey((k) => k + 1)}>
            Vernieuwen
          </button>
        </span>
      </div>
      <iframe key={frameKey} className="admin-frame" src={st.url} title="Icares administratie" />
      {progressModal}
    </div>
  )
}
