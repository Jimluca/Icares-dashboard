import { useCallback, useEffect, useState } from 'react'
import { MODULES, type ScriptDef } from '../../shared/scripts'
import type { Group, Role, SessionInfo, UserSummary } from '../../shared/types'
import { api, unwrap } from './api'
import { DbSettings } from './DbSettings'
import { Confirm, Icon, Modal, useAction } from './ui'

export function Admin({ session, onRefresh }: { session: SessionInfo; onRefresh: () => void }) {
  const [tab, setTab] = useState<'users' | 'groups' | 'db'>('users')
  const [users, setUsers] = useState<UserSummary[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [scripts, setScripts] = useState<ScriptDef[]>([])
  const [editUser, setEditUser] = useState<UserSummary | 'new' | null>(null)
  const [resetUser, setResetUser] = useState<UserSummary | null>(null)
  const [deleteUser, setDeleteUser] = useState<UserSummary | null>(null)
  const act = useAction()

  const load = useCallback(async () => {
    const [u, g, s] = await Promise.all([act(() => unwrap(api.listUsers())), act(() => unwrap(api.allGroups())), act(() => unwrap(api.allScripts()))])
    if (u) setUsers(u)
    if (g) setGroups(g)
    if (s) setScripts(s)
  }, [act])

  useEffect(() => {
    void load()
  }, [load])

  const groupName = (id: string): string => groups.find((g) => g.id === id)?.name ?? '?'

  return (
    <div className="page">
      <header className="pane-head">
        <h1>Beheer</h1>
      </header>
      <div className="tabs">
        <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>
          Gebruikers en rechten
        </button>
        <button className={tab === 'groups' ? 'on' : ''} onClick={() => setTab('groups')}>
          Wachtwoordgroepen
        </button>
        <button className={tab === 'db' ? 'on' : ''} onClick={() => setTab('db')}>
          Database-koppeling
        </button>
        <button
          className="tab-action"
          onClick={async () => {
            const p = await act(() => unwrap(api.exportVault()))
            if (p) act(() => Promise.resolve(p), `Kluis opgeslagen: ${p}`)
          }}
        >
          Kluis exporteren…
        </button>
      </div>

      {tab === 'users' && (
        <>
          <div className="row-between">
            <p className="muted">Inloggen gaat alleen met een wachtwoord. Elk wachtwoord hoort bij één persoon en moet dus uniek zijn.</p>
            <button className="btn btn-primary btn-sm" onClick={() => setEditUser('new')}>
              <Icon name="plus" /> Gebruiker toevoegen
            </button>
          </div>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Rol</th>
                  <th>Wachtwoordgroepen</th>
                  <th>Onderdelen en scripts</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="strong">
                      {u.name}
                      {u.id === session.userId && <span className="muted small"> (jij)</span>}
                    </td>
                    <td>
                      <span className={`pill ${u.role === 'superadmin' ? 'pill-super' : ''}`}>{u.role === 'superadmin' ? 'Super admin' : 'Admin'}</span>
                    </td>
                    <td className="small">{u.role === 'superadmin' ? 'Alles' : u.groupIds.map(groupName).join(', ') || '—'}</td>
                    <td className="small">
                      {u.role === 'superadmin'
                        ? 'Alles'
                        : [
                            ...MODULES.filter((m) => u.scriptIds.includes(m.id)).map((m) => m.title),
                            ...(u.scriptIds.filter((id) => scripts.some((s) => s.id === id)).length ? [`${u.scriptIds.filter((id) => scripts.some((s) => s.id === id)).length} van ${scripts.length} scripts`] : [])
                          ].join(', ') || '—'}
                    </td>
                    <td className="right nowrap">
                      {u.role !== 'superadmin' && (
                        <button className="btn btn-sm" onClick={() => setEditUser(u)}>
                          Rechten
                        </button>
                      )}
                      {u.id !== session.userId && (
                        <>
                          <button className="btn btn-sm" onClick={() => setResetUser(u)}>
                            Nieuw wachtwoord
                          </button>
                          <button className="btn btn-sm btn-ghost-danger" onClick={() => setDeleteUser(u)}>
                            Verwijderen
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'groups' && <GroupsTab groups={groups} onChange={() => { void load(); onRefresh() }} />}

      {tab === 'db' && <DbSettings />}

      {editUser && (
        <UserEditor
          user={editUser === 'new' ? null : editUser}
          groups={groups}
          scripts={scripts}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            setEditUser(null)
            void load()
          }}
        />
      )}
      {resetUser && <ResetPassword user={resetUser} onClose={() => setResetUser(null)} />}
      {deleteUser && (
        <Confirm
          title="Gebruiker verwijderen"
          text={<>Weet je zeker dat je <strong>{deleteUser.name}</strong> wilt verwijderen? Deze persoon kan daarna niet meer inloggen.</>}
          danger
          confirmLabel="Verwijderen"
          onClose={() => setDeleteUser(null)}
          onConfirm={async () => {
            const u = deleteUser
            setDeleteUser(null)
            await act(() => unwrap(api.deleteUser(u.id)), 'Gebruiker verwijderd.')
            void load()
          }}
        />
      )}
    </div>
  )
}

function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="input-with-btns">
      <input className="mono" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn btn-sm" onClick={async () => onChange(await api.generatePassword())}>
        Genereren
      </button>
    </div>
  )
}

function UserEditor({ user, groups, scripts, onClose, onSaved }: { user: UserSummary | null; groups: Group[]; scripts: ScriptDef[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('admin')
  const [password, setPassword] = useState('')
  const [groupIds, setGroupIds] = useState<string[]>(user?.groupIds ?? [])
  const [scriptIds, setScriptIds] = useState<string[]>(user?.scriptIds ?? [])
  const act = useAction()
  const toggle = (list: string[], set: (v: string[]) => void, id: string): void => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const categories = [...new Set(scripts.map((s) => s.category))]

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const ok = user
      ? await act(() => unwrap(api.setAccess(user.id, groupIds, scriptIds)).then(() => true), 'Rechten opgeslagen.')
      : await act(() => unwrap(api.createUser(name, role, password, groupIds, scriptIds)).then(() => true), 'Gebruiker aangemaakt. Geef het wachtwoord persoonlijk door.')
    if (ok) onSaved()
  }

  return (
    <Modal title={user ? `Rechten van ${user.name}` : 'Gebruiker toevoegen'} onClose={onClose} wide>
      <form onSubmit={save} className="stack">
        {!user && (
          <div className="grid-form">
            <label className="field">
              <span>Naam</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            </label>
            <label className="field">
              <span>Rol</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="admin">Admin (alleen wat jij aanvinkt)</option>
                <option value="superadmin">Super admin (alles)</option>
              </select>
            </label>
            <label className="field span2">
              <span>Wachtwoord (minstens 12 tekens; noteer het, je ziet het hierna niet meer)</span>
              <PasswordInput value={password} onChange={setPassword} />
            </label>
          </div>
        )}
        {role === 'admin' && (
          <div className="access">
            <fieldset>
              <legend>Wachtwoordgroepen</legend>
              {groups.map((g) => (
                <label key={g.id} className="check">
                  <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggle(groupIds, setGroupIds, g.id)} />
                  {g.name}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Onderdelen</legend>
              {MODULES.map((m) => (
                <label key={m.id} className="check">
                  <input type="checkbox" checked={scriptIds.includes(m.id)} onChange={() => toggle(scriptIds, setScriptIds, m.id)} />
                  {m.title}
                </label>
              ))}
              <legend className="sub-legend">Scripts</legend>
              {categories.map((c) => (
                <div key={c} className="access-cat">
                  <div className="cat-title">{c}</div>
                  {scripts
                    .filter((s) => s.category === c)
                    .map((s) => (
                      <label key={s.id} className="check">
                        <input type="checkbox" checked={scriptIds.includes(s.id)} onChange={() => toggle(scriptIds, setScriptIds, s.id)} />
                        {s.title}
                      </label>
                    ))}
                </div>
              ))}
            </fieldset>
          </div>
        )}
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            Annuleren
          </button>
          <button className="btn btn-primary">{user ? 'Opslaan' : 'Aanmaken'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPassword({ user, onClose }: { user: UserSummary; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const act = useAction()
  return (
    <Modal title={`Nieuw wachtwoord voor ${user.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          const ok = await act(() => unwrap(api.resetPassword(user.id, password)).then(() => true), 'Wachtwoord ingesteld. Geef het persoonlijk door.')
          if (ok) onClose()
        }}
      >
        <p className="muted">Het oude wachtwoord werkt hierna niet meer. Rechten blijven gelijk.</p>
        <label className="field">
          <span>Nieuw wachtwoord</span>
          <PasswordInput value={password} onChange={setPassword} />
        </label>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            Annuleren
          </button>
          <button className="btn btn-primary" disabled={!password}>
            Instellen
          </button>
        </div>
      </form>
    </Modal>
  )
}

function GroupsTab({ groups, onChange }: { groups: Group[]; onChange: () => void }) {
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<Record<string, string>>({})
  const act = useAction()
  return (
    <div className="card stack">
      <p className="muted">Elke groep heeft een eigen sleutel. Een admin kan alleen groepen openen die jij bij zijn rechten aanvinkt.</p>
      <table className="table">
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td>
                <input className="inline-input" value={renaming[g.id] ?? g.name} onChange={(e) => setRenaming({ ...renaming, [g.id]: e.target.value })} />
              </td>
              <td className="right nowrap">
                {renaming[g.id] !== undefined && renaming[g.id] !== g.name && (
                  <button className="btn btn-sm btn-primary" onClick={async () => {
                    await act(() => unwrap(api.renameGroup(g.id, renaming[g.id])), 'Naam gewijzigd.')
                    onChange()
                  }}>
                    Opslaan
                  </button>
                )}
                <button className="btn btn-sm btn-ghost-danger" onClick={async () => {
                  await act(() => unwrap(api.deleteGroup(g.id)), 'Groep verwijderd.')
                  onChange()
                }}>
                  Verwijderen
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="input-with-btns"
        onSubmit={async (e) => {
          e.preventDefault()
          const ok = await act(() => unwrap(api.addGroup(name)).then(() => true), 'Groep toegevoegd.')
          if (ok) {
            setName('')
            onChange()
          }
        }}
      >
        <input placeholder="Naam nieuwe groep, bijv. Administratie" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!name.trim()}>
          Toevoegen
        </button>
      </form>
    </div>
  )
}
