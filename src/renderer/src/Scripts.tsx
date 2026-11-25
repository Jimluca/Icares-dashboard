import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QueryResult, RequirementStatus, ScriptView } from '../../shared/ipc'
import { api, unwrap } from './api'
import { ResultTable, TunnelBar } from './Data'
import { LinkChecker } from './LinkChecker'
import { IpiInvoicing } from './IpiInvoicing'
import { IpiPaid } from './IpiPaid'
import { PeopleDelete } from './PeopleDelete'
import { FontysImport } from './FontysImport'
import { Confirm, Empty, Icon, useAction, useToast } from './ui'

const KIND_LABEL = { perl: 'PERL', python: 'PY', sql: 'SQL', powershell: 'PS', builtin: 'APP' } as const

export function Scripts() {
  const [scripts, setScripts] = useState<ScriptView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const act = useAction()

  useEffect(() => {
    void act(() => unwrap(api.listScripts())).then((s) => {
      if (s) {
        setScripts(s)
        setSelected((cur) => cur ?? s[0]?.id ?? null)
      }
    })
  }, [act])

  const byCat = useMemo(() => {
    const m = new Map<string, ScriptView[]>()
    for (const s of scripts) m.set(s.category, [...(m.get(s.category) ?? []), s])
    return [...m.entries()]
  }, [scripts])
  const current = scripts.find((s) => s.id === selected)

  return (
    <div className="split">
      <section className="list-pane">
        <header className="pane-head">
          <h1>Scripts</h1>
        </header>
        {byCat.map(([cat, list]) => (
          <div key={cat} className="cat">
            <div className="cat-title">{cat}</div>
            <ul className="entry-list">
              {list.map((s) => (
                <li key={s.id}>
                  <button className={`entry-row ${selected === s.id ? 'active' : ''}`} onClick={() => setSelected(s.id)}>
                    <span className={`kind kind-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                    <span className="entry-main">
                      <span className="entry-title">{s.title}</span>
                      <span className="entry-sub">{s.notDelivered ? 'Nog niet aangeleverd' : s.exists ? s.file : 'Bestand niet gevonden'}</span>
                    </span>
                    {s.danger && <span className="tag tag-warn">Let op</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {scripts.length === 0 && <Empty>Je hebt (nog) geen toegang tot scripts.</Empty>}
      </section>
      <section className="detail-pane">{current ? <ScriptDetail key={current.id} script={current} /> : <Empty>Kies links een script.</Empty>}</section>
    </div>
  )
}

function ScriptDetail({ script }: { script: ScriptView }) {
  const [reqs, setReqs] = useState<RequirementStatus[] | null>(null)
  const [args, setArgs] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const act = useAction()
  const toast = useToast()

  const checkReqs = useCallback(() => {
    if (script.allRequires.length === 0) return setReqs([])
    setReqs(null)
    void api.checkRequirements(script.allRequires).then(setReqs)
  }, [script.allRequires])

  useEffect(() => checkReqs(), [checkReqs])

  const runSql = async (): Promise<void> => {
    setRunning(true)
    const r = await act(() => unwrap(api.runSql(script.id)))
    setRunning(false)
    if (r) setResult(r)
  }

  const missing = reqs?.filter((r) => !r.ok) ?? []
  const start = async (): Promise<void> => {
    setConfirm(false)
    await act(() => unwrap(api.runScript(script.id, args)), 'Terminalvenster geopend.')
  }

  return (
    <div className="detail">
      <header className="detail-head">
        <span className={`kind kind-${script.kind} kind-lg`}>{KIND_LABEL[script.kind]}</span>
        <div>
          <h2>{script.title}</h2>
          <div className="muted small">{script.category}</div>
        </div>
      </header>
      <p className="lead">{script.summary}</p>

      {script.notDelivered && (
        <div className="notice notice-warn">De bestanden van dit script zijn nog niet aangeleverd (map {script.folder}). Zet ze in de scriptmap, dan werkt de knop vanzelf.</div>
      )}
      {script.bundled && (
        <div className="notice notice-ok">De SharePoint-map met scripts staat niet op deze pc; het dashboard gebruikt de ingebouwde kopie. Dit werkt gewoon.</div>
      )}
      {!script.notDelivered && !script.exists && <div className="notice notice-warn">Script niet gevonden op {script.fullPath}. Controleer de scriptmap bij "Deze pc".</div>}
      {script.danger && <div className="notice notice-danger">{script.danger}</div>}

      {(script.needsTunnel || script.kind === 'sql') && <TunnelBar />}

      <h3>Stappen</h3>
      <ol className="steps">
        {script.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>

      {script.args && script.args.length > 0 && (
        <>
          <h3>Invoer</h3>
          <div className="stack">
            {script.args.map((a) => (
              <label className="field" key={a.id}>
                <span>
                  {a.label}
                  {a.optional && <em className="muted"> (optioneel)</em>}
                </span>
                <div className="input-with-btns">
                  <input
                    type={a.type === 'number' ? 'number' : 'text'}
                    placeholder={a.placeholder}
                    value={args[a.id] ?? ''}
                    onChange={(e) => setArgs({ ...args, [a.id]: e.target.value })}
                  />
                  {a.type === 'file' && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const f = await act(() => unwrap(api.pickFile(script.id, a.id, !!a.save)))
                        if (f) setArgs({ ...args, [a.id]: f })
                      }}
                    >
                      Kiezen…
                    </button>
                  )}
                </div>
              </label>
            ))}
          </div>
        </>
      )}

      {script.allRequires.length > 0 && <h3>Benodigd</h3>}
      {script.allRequires.length === 0 ? null : reqs === null ? (
        <p className="muted small">Controleren…</p>
      ) : (
        <ul className="reqs">
          {reqs.map((r) => (
            <li key={r.id} className={r.ok ? 'ok' : 'nok'} title={r.detail}>
              <span className="dot" /> {r.label}
            </li>
          ))}
          <li>
            <button className="link-btn" onClick={checkReqs}>
              Opnieuw controleren
            </button>
          </li>
        </ul>
      )}
      {missing.length > 0 && <p className="muted small">Ontbreekt er iets? Installeer het via "Deze pc".</p>}

      {script.kind === 'builtin' && <h3>Aan de slag</h3>}
      {script.kind === 'builtin' && script.id === 'linkchecker' && <LinkChecker />}
      {script.kind === 'builtin' && script.id === 'ipi-facturen' && <IpiInvoicing />}
      {script.kind === 'builtin' && script.id === 'ipi-betaald' && <IpiPaid />}
      {script.kind === 'builtin' && script.id === 'clienten-verwijderen' && <PeopleDelete />}
      {script.kind === 'builtin' && script.id === 'fontys-studenten' && <FontysImport />}

      {script.kind !== 'builtin' && (
      <div className="actions">
        {script.kind === 'sql' ? (
          <>
            <button className="btn btn-primary" disabled={!script.exists || running} onClick={() => void runSql()}>
              <Icon name="play" /> {running ? 'Bezig…' : 'Uitvoeren'}
            </button>
            <button
              className="btn"
              disabled={!script.exists}
              onClick={async () => {
                const s = await act(() => unwrap(api.copySql(script.id)))
                if (s) toast('SQL gekopieerd.')
              }}
            >
              <Icon name="copy" /> SQL kopiëren
            </button>
          </>
        ) : (
          <button className="btn btn-primary" disabled={!script.exists} onClick={() => (script.danger ? setConfirm(true) : void start())}>
            <Icon name="play" /> Start
          </button>
        )}
        <button className="btn" onClick={() => act(() => unwrap(api.openScriptFolder(script.id)))}>
          <Icon name="folder" /> Map openen
        </button>
        {script.kind !== 'sql' && (
          <button className="btn" disabled={!script.exists} onClick={() => act(() => unwrap(api.editScript(script.id)))}>
            <Icon name="edit" /> Script openen in editor
          </button>
        )}
        {script.docs?.map((d, i) => (
          <button key={d.path} className="btn" onClick={() => act(() => unwrap(api.openDoc(script.id, i)))}>
            <Icon name="doc" /> {d.label}
          </button>
        ))}
      </div>
      )}
      {result && script.kind === 'sql' && (
        <>
          <h3>Resultaat</h3>
          <ResultTable result={result} name={script.title} />
        </>
      )}
      {script.kind !== 'builtin' && <p className="muted small mono path">{script.fullPath}</p>}

      {confirm && (
        <Confirm
          title="Weet je het zeker?"
          text={script.danger}
          danger
          confirmLabel="Ja, starten"
          onClose={() => setConfirm(false)}
          onConfirm={() => void start()}
        />
      )}
    </div>
  )
}
