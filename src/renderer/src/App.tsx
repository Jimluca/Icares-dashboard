import { useEffect, useRef, useState } from 'react'
import type { SessionInfo } from '../../shared/types'
import { api, unwrap } from './api'
import { Admin } from './Admin'
import { Administratie } from './Administratie'
import { Passwords } from './Passwords'
import { Scripts } from './Scripts'
import { ThisPc } from './ThisPc'
import { Icon, Modal, useAction, useToast } from './ui'

type Page = 'passwords' | 'scripts' | 'pc' | 'admin' | 'administratie'

export function App() {
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined)
  const toast = useToast()

  useEffect(() => {
    void api.session().then(setSession)
    return api.onLocked(() => {
      setSession(null)
      toast('Automatisch vergrendeld na 10 minuten zonder activiteit.')
    })
  }, [toast])

  // activiteit doorgeven zodat de automatische vergrendeling opschuift
  const last = useRef(0)
  useEffect(() => {
    const ping = (): void => {
      if (Date.now() - last.current > 30_000) {
        last.current = Date.now()
        api.activity()
      }
    }
    window.addEventListener('mousemove', ping)
    window.addEventListener('keydown', ping)
    return () => {
      window.removeEventListener('mousemove', ping)
      window.removeEventListener('keydown', ping)
    }
  }, [])

  if (session === undefined) return null
  if (!session) return <Login onLogin={setSession} />
  return <Shell session={session} onRefresh={() => void api.session().then(setSession)} onLogout={() => void api.logout().then(() => setSession(null))} />
}

function Login({ onLogin }: { onLogin: (s: SessionInfo) => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hasVault, setHasVault] = useState(true)
  useEffect(() => {
    void api.vaultExists().then(setHasVault)
  }, [])
  const importVault = async (): Promise<void> => {
    setError('')
    const r = await api.importVault()
    if (!r.ok) setError(r.error)
    else if (r.value) {
      setHasVault(true)
      setError('')
    }
  }
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!pw) return
    setBusy(true)
    setError('')
    const r = await api.login(pw)
    setBusy(false)
    if (r.ok) onLogin(r.value)
    else {
      setError(r.error)
      setPw('')
    }
  }
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            Icares <strong>Dashboard</strong>
          </span>
        </div>
        <p className="muted">Log in met je persoonlijke wachtwoord.</p>
        <label className="field">
          <span>Wachtwoord</span>
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy} autoComplete="current-password" />
        </label>
        {error && <div className="form-error">{error}</div>}
        {hasVault ? (
          <button className="btn btn-primary btn-block" disabled={busy || !pw}>
            {busy ? 'Kluis openen…' : 'Inloggen'}
          </button>
        ) : (
          <div className="notice notice-warn">Op deze pc staat nog geen kluis. Importeer het kluisbestand dat je van de super admin hebt gekregen.</div>
        )}
        <button type="button" className={hasVault ? 'link-btn center' : 'btn btn-block'} onClick={() => void importVault()}>
          {hasVault ? 'Ander kluisbestand importeren…' : 'Kluisbestand importeren…'}
        </button>
      </form>
    </div>
  )
}

function Shell({ session, onLogout, onRefresh }: { session: SessionInfo; onLogout: () => void; onRefresh: () => void }) {
  const [page, setPage] = useState<Page>('passwords')
  const [changePw, setChangePw] = useState(false)
  const isSuper = session.role === 'superadmin'
  const canAdministratie = isSuper || session.scriptIds.includes('administratie')
  const nav: { id: Page; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
    { id: 'passwords', label: 'Wachtwoorden', icon: 'key' },
    { id: 'scripts', label: 'Scripts', icon: 'terminal' },
    { id: 'pc', label: 'Deze pc', icon: 'pc' },
    ...(isSuper ? [{ id: 'admin' as Page, label: 'Beheer', icon: 'shield' as const }] : [])
  ]
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            Icares <strong>Dashboard</strong>
          </span>
        </div>
        <nav>
          {nav.map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
              <Icon name={n.icon} />
              {n.label}
            </button>
          ))}
          {canAdministratie && (
            <button className={`nav-item ${page === 'administratie' ? 'active' : ''}`} onClick={() => setPage('administratie')}>
              <Icon name="doc" />
              Administratie
            </button>
          )}
          <div className="nav-sep">Binnenkort</div>
          <button className="nav-item disabled" disabled title="Volgt in een volgende stap">
            <Icon name="doc" />
            Prijslijsten
          </button>
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <div className="who-name">{session.name}</div>
            <div className="who-role">{isSuper ? 'Super admin' : 'Admin'}</div>
          </div>
          <button className="nav-item small" onClick={() => setChangePw(true)}>
            <Icon name="key" />
            Mijn wachtwoord
          </button>
          <button className="nav-item small" onClick={onLogout}>
            <Icon name="lock" />
            Vergrendelen
          </button>
        </div>
      </aside>
      <main className="content">
        {page === 'passwords' && <Passwords session={session} />}
        {page === 'scripts' && <Scripts />}
        {page === 'pc' && <ThisPc />}
        {page === 'administratie' && canAdministratie && <Administratie />}
        {page === 'admin' && isSuper && <Admin session={session} onRefresh={onRefresh} />}
      </main>
      {changePw && <ChangePassword onClose={() => setChangePw(false)} />}
    </div>
  )
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const act = useAction()
  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (next !== again) {
      await act(() => Promise.reject(new Error('De nieuwe wachtwoorden zijn niet gelijk.')))
      return
    }
    const ok = await act(() => unwrap(api.changeOwnPassword(cur, next)).then(() => true), 'Wachtwoord gewijzigd.')
    if (ok) onClose()
  }
  return (
    <Modal title="Mijn wachtwoord wijzigen" onClose={onClose}>
      <form onSubmit={save} className="stack">
        <label className="field">
          <span>Huidig wachtwoord</span>
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Nieuw wachtwoord (minstens 12 tekens)</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span>Nieuw wachtwoord nogmaals</span>
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>
            Annuleren
          </button>
          <button className="btn btn-primary" disabled={!cur || !next}>
            Opslaan
          </button>
        </div>
      </form>
    </Modal>
  )
}
