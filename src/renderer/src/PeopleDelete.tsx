import { useEffect, useMemo, useState } from 'react'
import { DELETABLE_ROLES, ROLE_LABEL, STATUS_LABEL, STATUS_ROLES, type OrgPerson, type OrgSearchHit } from '../../shared/people'
import { api, unwrap } from './api'
import { Confirm, Modal, useAction, useToast } from './ui'

const ROLE_ORDER = ['organization manager', 'professional', 'client']
const PER_GROUP = 100

export function PeopleDelete() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<OrgSearchHit[]>([])
  const [org, setOrg] = useState<OrgSearchHit | null>(null)
  const [people, setPeople] = useState<OrgPerson[] | null>(null)
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState<OrgPerson | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [deleted, setDeleted] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [statusChange, setStatusChange] = useState<{ p: OrgPerson; to: string } | null>(null)
  const [emailEdit, setEmailEdit] = useState<{ p: OrgPerson; value: string } | null>(null)
  const act = useAction()
  const toast = useToast()

  // Zoeken terwijl je typt (met korte vertraging)
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(async () => {
      const r = await act(() => unwrap(api.peopleSearchOrgs(q)))
      if (r) setHits(r)
    }, 350)
    return () => clearTimeout(t)
  }, [q, act])

  const choose = async (o: OrgSearchHit): Promise<void> => {
    setOrg(o)
    setHits([])
    setQ(o.name)
    setPeople(null)
    setDeleted([])
    const r = await act(() => unwrap(api.peopleList(o.id)))
    if (r) setPeople(r)
    if (statuses.length === 0) {
      const st = await act(() => unwrap(api.peopleStatusOptions()))
      if (st) setStatuses(st)
    }
  }

  const update = (id: number, patch: Partial<OrgPerson>): void => setPeople((list) => list?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? null)

  const applyStatus = async (p: OrgPerson, to: string): Promise<void> => {
    setStatusChange(null)
    if (!org) return
    setBusyId(p.id)
    const r = await act(() => unwrap(api.peopleSetStatus(org.id, p.id, to)))
    setBusyId(null)
    if (r) {
      update(p.id, { status: r })
      toast(`${p.name || p.email}: status is nu "${STATUS_LABEL[r] ?? r}".`)
    }
  }

  const applyEmail = async (p: OrgPerson, email: string): Promise<void> => {
    if (!org) return
    setBusyId(p.id)
    const r = await act(() => unwrap(api.peopleSetEmail(org.id, p.id, email)))
    setBusyId(null)
    if (r) {
      setEmailEdit(null)
      update(p.id, { email: r })
      toast(`E-mailadres van ${p.name || p.id} is nu ${r}.`)
    }
  }

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = (people ?? []).filter((p) => !f || [p.name, p.email, String(p.id)].some((v) => v.toLowerCase().includes(f)))
    const roles = [...new Set([...ROLE_ORDER, ...list.map((p) => p.role)])]
    return roles.map((r) => ({ role: r, list: list.filter((p) => p.role === r) })).filter((g) => g.list.length > 0)
  }, [people, filter])

  const remove = async (p: OrgPerson): Promise<void> => {
    setTarget(null)
    if (!org) return
    setBusyId(p.id)
    const r = await act(() => unwrap(api.peopleDelete(org.id, p.id)))
    setBusyId(null)
    if (r) {
      toast(`${p.name || p.email} is verwijderd.`)
      setDeleted((d) => [...d, `${p.name || p.email} (${ROLE_LABEL[p.role] ?? p.role}, user-id ${p.id})`])
      setPeople((list) => list?.filter((x) => x.id !== p.id) ?? null)
    }
  }

  return (
    <div className="stack">
      <div className="search-org">
        <input placeholder="Typ de naam (of het id) van de organisatie…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {hits.length > 0 && (
          <ul className="hits">
            {hits.map((h) => (
              <li key={h.id}>
                <button onClick={() => void choose(h)}>
                  <strong>{h.name}</strong> <span className="muted small">org-id {h.id} · {h.people} personen</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {org && people === null && <p className="muted">Personen ophalen…</p>}
      {org && people && (
        <>
          <h2>
            {org.name} <span className="muted small">org-id {org.id} · {people.length} personen</span>
          </h2>
          <div className="person-search">
            <input
              placeholder="Zoek een persoon op naam, e-mail of user-id…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
            {filter && (
              <button className="btn btn-sm" onClick={() => setFilter('')}>
                Wissen
              </button>
            )}
          </div>
          {filter && groups.length === 0 && <div className="notice notice-warn">Niemand gevonden met "{filter}".</div>}
          {people.length === 0 && <div className="notice notice-ok">Deze organisatie heeft geen personen (meer).</div>}
          {groups.map((g) => (
            <div key={g.role} className="card">
              <h3>
                {ROLE_LABEL[g.role] ?? g.role} ({g.list.length})
              </h3>
              <table className="data people">
                <colgroup>
                  <col className="c-name" />
                  <col className="c-mail" />
                  <col className="c-id" />
                  <col className="c-status" />
                  <col className="c-extra" />
                  <col className="c-x" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Naam</th>
                    <th>E-mail</th>
                    <th>user-id</th>
                    <th>Status</th>
                    <th>{g.role === 'client' ? 'Professional' : g.role === 'professional' ? 'Cliënten' : 'Sinds'}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {g.list.slice(0, PER_GROUP).map((p) => (
                    <tr key={p.id} className={p.status && p.status !== 'active' ? 'inactive-row' : ''}>
                      <td className="strong" title={`${p.name} · sinds ${p.createdAt}`}>{p.name || '—'}</td>
                      <td title={p.email}>{p.email}</td>
                      <td>{p.id}</td>
                      <td>
                        {STATUS_ROLES.includes(p.role) && statuses.length > 0 ? (
                          <select
                            className={`status-select st-${p.status}`}
                            value={p.status}
                            disabled={busyId !== null}
                            onChange={(e) => setStatusChange({ p, to: e.target.value })}
                            aria-label={`Status van ${p.name || p.email}`}
                          >
                            {[...new Set([p.status, ...statuses])].map((st) => (
                              <option key={st} value={st}>
                                {STATUS_LABEL[st] ?? st}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`st-text st-${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                        )}
                      </td>
                      <td title={g.role === 'client' ? p.professionals : undefined}>{g.role === 'client' ? p.professionals || '—' : g.role === 'professional' ? p.clients : p.createdAt}</td>
                      <td className="right">
                        {DELETABLE_ROLES.includes(p.role) ? (
                          <div className="row-actions">
                            <button className="icon-mini" title={`E-mailadres van ${p.name || p.email} wijzigen`} aria-label={`E-mailadres van ${p.name || p.email} wijzigen`} disabled={busyId !== null} onClick={() => setEmailEdit({ p, value: p.email })}>
                              ✎
                            </button>
                            <button className="x-btn" title={`${p.name || p.email} verwijderen`} aria-label={`${p.name || p.email} verwijderen`} disabled={busyId !== null} onClick={() => setTarget(p)}>
                              {busyId === p.id ? '…' : '✕'}
                            </button>
                          </div>
                        ) : (
                          <span className="muted small">beheerder</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {g.list.length > PER_GROUP && (
                <p className="muted small">
                  Eerste {PER_GROUP} van {g.list.length} getoond. Gebruik de zoekbalk hierboven om iemand anders te vinden.
                </p>
              )}
            </div>
          ))}
          {people.length > 0 && (
            <p className="muted small">
              Wijzigingen worden vastgelegd in een{' '}
              <button className="link-btn" onClick={() => act(() => unwrap(api.openAuditLog()))}>
                logboek op deze pc
              </button>
              . Eerst proberen zonder te verwijderen?{' '}
              <button className="link-btn" onClick={() => act(() => unwrap(api.peopleDryRun(people[people.length - 1].id)), undefined).then((m) => m && toast(m))}>
                Inloggen testen
              </button>
            </p>
          )}
        </>
      )}

      {deleted.length > 0 && (
        <div className="notice notice-ok">
          <strong>Verwijderd in deze sessie:</strong>
          <ul className="plain">
            {deleted.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {statusChange && (
        <Confirm
          title="Status wijzigen?"
          danger={statusChange.to !== 'active'}
          confirmLabel={`Ja, ${(STATUS_LABEL[statusChange.to] ?? statusChange.to).toLowerCase()} maken`}
          onClose={() => setStatusChange(null)}
          onConfirm={() => void applyStatus(statusChange.p, statusChange.to)}
          text={
            <>
              <p>
                <strong>{statusChange.p.name || statusChange.p.email}</strong> ({ROLE_LABEL[statusChange.p.role] ?? statusChange.p.role}, {statusChange.p.email}) gaat van{' '}
                <strong>{STATUS_LABEL[statusChange.p.status] ?? statusChange.p.status}</strong> naar <strong>{STATUS_LABEL[statusChange.to] ?? statusChange.to}</strong>.
              </p>
              {statusChange.to !== 'active' && <p>Deze persoon kan daarna niet meer inloggen in Icares Professional. Je kunt dit later hier weer terugzetten naar Actief.</p>}
              {statusChange.p.role === 'professional' && statusChange.p.clients > 0 && statusChange.to !== 'active' && (
                <p className="form-error">Deze professional heeft {statusChange.p.clients} gekoppelde cliënt(en).</p>
              )}
            </>
          }
        />
      )}

      {emailEdit && (
        <Modal title="E-mailadres wijzigen" onClose={() => setEmailEdit(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              void applyEmail(emailEdit.p, emailEdit.value)
            }}
          >
            <p>
              <strong>{emailEdit.p.name || '—'}</strong> ({ROLE_LABEL[emailEdit.p.role] ?? emailEdit.p.role}, user-id {emailEdit.p.id})
            </p>
            <label className="field">
              <span>Huidig: {emailEdit.p.email}</span>
              <input type="email" value={emailEdit.value} onChange={(e) => setEmailEdit({ ...emailEdit, value: e.target.value })} autoFocus />
            </label>
            <p className="muted small">Het e-mailadres is ook de inlognaam in Icares Professional. Laat de persoon weten dat die voortaan met het nieuwe adres inlogt.</p>
            <div className="row-end">
              <button type="button" className="btn" onClick={() => setEmailEdit(null)}>
                Annuleren
              </button>
              <button className="btn btn-primary" disabled={busyId !== null || !emailEdit.value.trim() || emailEdit.value.trim() === emailEdit.p.email}>
                Opslaan
              </button>
            </div>
          </form>
        </Modal>
      )}

      {target && (
        <Confirm
          title="Persoon verwijderen?"
          danger
          confirmLabel="Ja, definitief verwijderen"
          onClose={() => setTarget(null)}
          onConfirm={() => void remove(target)}
          text={
            <>
              <p>
                Je verwijdert <strong>{target.name || target.email}</strong> ({ROLE_LABEL[target.role] ?? target.role}, user-id {target.id}, {target.email}) van <strong>{org?.name}</strong> uit de database van Icares Professional.
              </p>
              {target.role === 'professional' && target.clients > 0 && (
                <p className="form-error">Deze professional heeft {target.clients} gekoppelde cliënt(en). Controleer of die eerst naar iemand anders moeten.</p>
              )}
              {target.role === 'organization manager' && <p className="form-error">Dit is een organisatiemanager. Zorg dat de organisatie daarna nog een manager heeft.</p>}
              <p>
                <strong>Dit kan niet ongedaan worden gemaakt.</strong>
              </p>
            </>
          }
        />
      )}
    </div>
  )
}
