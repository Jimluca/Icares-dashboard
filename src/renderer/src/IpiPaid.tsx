import { useMemo, useState } from 'react'
import { euro, type MarkPaidResult, type OpenInvoice } from '../../shared/ipi'
import { api, unwrap } from './api'
import { Confirm, useAction } from './ui'

export function IpiPaid() {
  const [list, setList] = useState<OpenInvoice[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MarkPaidResult | null>(null)
  const act = useAction()

  const load = async (): Promise<void> => {
    setLoading(true)
    const r = await act(() => unwrap(api.ipiOpenInvoices()))
    setLoading(false)
    if (r) {
      setList(r)
      setSelected(new Set())
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/^ipi/, '')
    if (!list) return []
    if (!q) return list
    return list.filter((i) => [i.nr, String(Number(i.nr)), String(i.userId), i.orgName, i.firstname, i.lastname, i.email].some((v) => v.toLowerCase().includes(q)))
  }, [list, filter])

  const chosen = list?.filter((i) => selected.has(i.userId)) ?? []
  const total = chosen.reduce((s, i) => s + i.totalIncl, 0)
  const toggle = (id: number): void => {
    const n = new Set(selected)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setSelected(n)
  }

  const markPaid = async (): Promise<void> => {
    setConfirm(false)
    setBusy(true)
    const r = await act(() => unwrap(api.ipiMarkPaid([...selected])))
    setBusy(false)
    if (r) {
      setResult(r)
      await load()
    }
  }

  const expired = list?.filter((i) => i.expired).length ?? 0

  return (
    <div className="stack">
      <div className="row-wrap">
        <button className="btn btn-primary" disabled={loading} onClick={() => void load()}>
          {loading ? 'Ophalen…' : list ? 'Vernieuwen' : 'Openstaande facturen ophalen'}
        </button>
        {list && (
          <span className="muted small">
            {list.length} openstaand{expired > 0 && <span className="form-error"> · {expired} verlopen</span>}
          </span>
        )}
      </div>

      {result && (
        <div className={`notice ${result.warnings.length ? 'notice-warn' : 'notice-ok'}`}>
          {result.updated} factuur/facturen op betaald gezet; {result.overviewRemoved} regel(s) uit het overzicht gehaald.
          {result.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      {list && list.length === 0 && <div className="notice notice-ok">Er staan geen IPI-facturen open.</div>}
      {list && list.length > 0 && (
        <>
          <div className="row-wrap">
            <input className="grow" placeholder="Zoek op factuurnummer (bijv. IPI0574), organisatie, naam of user-id" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="btn btn-danger" disabled={selected.size === 0 || busy} onClick={() => setConfirm(true)}>
              {busy ? 'Bezig…' : `Op betaald zetten (${selected.size})`}
            </button>
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th />
                  <th>Factuur</th>
                  <th>Datum</th>
                  <th>Bedrag</th>
                  <th>Organisatie</th>
                  <th>Cliënt</th>
                  <th>user-id</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.userId} className={i.expired ? 'bad' : ''} onClick={() => toggle(i.userId)} style={{ cursor: 'pointer' }}>
                    <td>
                      <input type="checkbox" checked={selected.has(i.userId)} onChange={() => toggle(i.userId)} onClick={(e) => e.stopPropagation()} aria-label={`IPI${i.nr} selecteren`} />
                    </td>
                    <td className="strong">IPI{i.nr}</td>
                    <td>
                      {i.date}
                      {i.expired && ' · verlopen'}
                    </td>
                    <td>€ {euro(i.totalIncl)}</td>
                    <td>{i.orgName}</td>
                    <td>{[i.firstname, i.middlename, i.lastname].filter(Boolean).join(' ')}</td>
                    <td>{i.userId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirm && (
        <Confirm
          title="Op betaald zetten?"
          danger
          confirmLabel="Ja, op betaald zetten"
          onClose={() => setConfirm(false)}
          onConfirm={() => void markPaid()}
          text={
            <>
              <p>
                Deze {chosen.length} {chosen.length === 1 ? 'factuur wordt' : 'facturen worden'} in Icares Professional op <strong>PAYED</strong> gezet en uit het overzicht met openstaande facturen gehaald (totaal € {euro(total)}):
              </p>
              <ul className="plain">
                {chosen.map((i) => (
                  <li key={i.userId}>
                    IPI{i.nr} · {i.orgName} · € {euro(i.totalIncl)}
                  </li>
                ))}
              </ul>
            </>
          }
        />
      )}
    </div>
  )
}
