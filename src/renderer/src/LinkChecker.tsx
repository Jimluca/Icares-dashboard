import { useEffect, useMemo, useState } from 'react'
import type { Institution, LinkResult, QueryResult } from '../../shared/ipc'
import { api, unwrap } from './api'
import { ResultTable, TunnelBar } from './Data'
import { Icon, useAction } from './ui'

interface Source {
  label: string
  urls: string[]
  /** Extra kolommen per link (uit de database), op volgorde van urls. */
  meta?: { columns: string[]; byUrl: Map<string, (string | number | null)[]> }
}

export function LinkChecker() {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [inst, setInst] = useState<string>('')
  const [source, setSource] = useState<Source | null>(null)
  const [busy, setBusy] = useState<'fetch' | 'check' | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<LinkResult[] | null>(null)
  const act = useAction()

  useEffect(() => {
    void act(() => unwrap(api.linkInstitutions())).then((l) => l && setInstitutions(l))
    return api.onLinkProgress((done, total) => setProgress({ done, total }))
  }, [act])

  const fromDb = async (): Promise<void> => {
    const id = Number(inst)
    if (!id) return
    setBusy('fetch')
    const r = await act(() => unwrap(api.linkUrlsFromDb(id)))
    setBusy(null)
    if (!r) return
    const urlCol = r.columns.findIndex((c) => /website/i.test(c))
    const byUrl = new Map<string, (string | number | null)[]>()
    for (const row of r.rows) {
      const u = String(row[urlCol] ?? '').trim()
      if (u && !byUrl.has(u)) byUrl.set(u, row.filter((_, i) => i !== urlCol))
    }
    const name = institutions.find((x) => x.id === id)?.name ?? `instelling ${id}`
    setSource({ label: `${name}: ${byUrl.size} unieke links (${r.rows.length} rijen)`, urls: [...byUrl.keys()], meta: { columns: r.columns.filter((_, i) => i !== urlCol), byUrl } })
    setResults(null)
  }

  const fromFile = async (): Promise<void> => {
    const r = await act(() => unwrap(api.linkUrlsFromFile()))
    if (!r) return
    setSource({ label: `${r.file.split('\\').pop()}: ${r.urls.length} links`, urls: r.urls })
    setResults(null)
  }

  const check = async (): Promise<void> => {
    if (!source) return
    setBusy('check')
    setProgress({ done: 0, total: source.urls.length })
    const r = await act(() => unwrap(api.linkCheck(source.urls)))
    setBusy(null)
    if (r) setResults(r)
  }

  const table: QueryResult | null = useMemo(() => {
    if (!results) return null
    const metaCols = source?.meta?.columns ?? []
    const order = (r: LinkResult): number => (r.ok ? 1 : 0)
    const sorted = [...results].sort((a, b) => order(a) - order(b))
    return {
      columns: ['werkt', 'status', 'link', 'eindadres', 'omleidingen', 'fout', ...metaCols],
      rows: sorted.map((r) => [r.ok ? 'ja' : 'nee', r.status, r.url, r.finalUrl, r.redirects, r.error, ...(source?.meta?.byUrl.get(r.url) ?? metaCols.map(() => null))]),
      truncated: false,
      ms: 0
    }
  }, [results, source])

  const broken = results?.filter((r) => !r.ok).length ?? 0
  const instName = institutions.find((x) => String(x.id) === inst)?.name

  return (
    <div className="stack">
      <h3>1. Links kiezen</h3>
      <TunnelBar />
      <div className="row-wrap">
        <select value={inst} onChange={(e) => setInst(e.target.value)} className="grow">
          <option value="">Kies een onderwijsinstelling…</option>
          {institutions.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.id})
            </option>
          ))}
        </select>
        <button className="btn" disabled={!inst || busy !== null} onClick={() => void fromDb()}>
          {busy === 'fetch' ? 'Ophalen…' : 'Links ophalen uit database'}
        </button>
        <span className="muted">of</span>
        <button className="btn" disabled={busy !== null} onClick={() => void fromFile()}>
          <Icon name="doc" /> .txt-bestand kiezen
        </button>
      </div>
      {source && <div className="notice notice-ok">{source.label}</div>}

      <h3>2. Controleren</h3>
      <div className="row-wrap">
        <button className="btn btn-primary" disabled={!source || source.urls.length === 0 || busy !== null} onClick={() => void check()}>
          <Icon name="play" /> Links controleren
        </button>
        {busy === 'check' && (
          <>
            <progress max={progress?.total ?? 1} value={progress?.done ?? 0} className="grow" />
            <span className="muted small">
              {progress?.done ?? 0} / {progress?.total ?? 0}
            </span>
            <button className="btn btn-sm" onClick={() => void api.linkCancel()}>
              Stoppen
            </button>
          </>
        )}
      </div>

      {results && table && (
        <>
          <h3>3. Resultaat</h3>
          <div className={`notice ${broken ? 'notice-danger' : 'notice-ok'}`}>
            {broken ? `${broken} van ${results.length} links werken niet (bovenaan, rood).` : `Alle ${results.length} links werken.`}
          </div>
          <ResultTable result={table} name={`linkcheck ${instName ?? 'links'}`} okColumn={0} />
        </>
      )}
    </div>
  )
}
