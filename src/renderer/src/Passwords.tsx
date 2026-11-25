import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CopyField, EditableEntry } from '../../shared/ipc'
import type { EntryInput, EntrySummary, SessionInfo, TotpCode } from '../../shared/types'
import { api, unwrap } from './api'
import { Confirm, Empty, Icon, Modal, useAction, useToast } from './ui'

export function Passwords({ session }: { session: SessionInfo }) {
  const [entries, setEntries] = useState<EntrySummary[]>([])
  const [codes, setCodes] = useState<Record<string, TotpCode>>({})
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditableEntry | 'new' | null>(null)
  const act = useAction()
  const isSuper = session.role === 'superadmin'

  const load = useCallback(async () => {
    const list = await act(() => unwrap(api.listEntries()))
    if (list) setEntries(list.sort((a, b) => a.title.localeCompare(b.title, 'nl')))
  }, [act])

  useEffect(() => {
    void load()
  }, [load])

  // 2FA-codes elke seconde verversen
  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      const r = await api.totpCodes()
      if (alive && r.ok) setCodes(Object.fromEntries(r.value.map((c) => [c.entryId, c])))
    }
    void tick()
    const t = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const groupName = useMemo(() => Object.fromEntries(session.groups.map((g) => [g.id, g.name])), [session.groups])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter(
      (e) =>
        (group === 'all' || e.groupId === group) &&
        (!q || [e.title, e.username, ...e.urls, e.notes].some((v) => v?.toLowerCase().includes(q)))
    )
  }, [entries, query, group])

  const current = entries.find((e) => e.id === selected) ?? null

  return (
    <div className="split">
      <section className="list-pane">
        <header className="pane-head">
          <h1>Wachtwoorden</h1>
          {isSuper && (
            <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
              <Icon name="plus" /> Nieuw
            </button>
          )}
        </header>
        <div className="search">
          <Icon name="search" />
          <input placeholder="Zoeken op naam, gebruiker of website" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        <div className="chips">
          <button className={`chip ${group === 'all' ? 'on' : ''}`} onClick={() => setGroup('all')}>
            Alles <span>{entries.length}</span>
          </button>
          {session.groups.map((g) => (
            <button key={g.id} className={`chip ${group === g.id ? 'on' : ''}`} onClick={() => setGroup(g.id)}>
              {g.name} <span>{entries.filter((e) => e.groupId === g.id).length}</span>
            </button>
          ))}
        </div>
        <ul className="entry-list">
          {filtered.map((e) => (
            <li key={e.id}>
              <button className={`entry-row ${selected === e.id ? 'active' : ''}`} onClick={() => setSelected(e.id)}>
                <span className="avatar" aria-hidden="true">
                  {e.title.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '•'}
                </span>
                <span className="entry-main">
                  <span className="entry-title">{e.title}</span>
                  <span className="entry-sub">{e.kind === 'note' ? 'Notitie' : e.username || '—'}</span>
                </span>
                {e.hasTotp && <span className="tag">2FA</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <Empty>Geen items gevonden.</Empty>}
        </ul>
      </section>
      <section className="detail-pane">
        {current ? (
          <EntryDetail
            key={current.id}
            entry={current}
            groupName={groupName[current.groupId]}
            code={codes[current.id]}
            isSuper={isSuper}
            onEdit={async () => {
              const full = await act(() => unwrap(api.getEntry(current.id)))
              if (full) setEditing(full)
            }}
            onDeleted={() => {
              setSelected(null)
              void load()
            }}
          />
        ) : (
          <Empty>
            <Icon name="key" />
            <p>Kies links een item.</p>
            <p className="muted small">Gekopieerde wachtwoorden worden na 30 seconden van het klembord gewist.</p>
          </Empty>
        )}
      </section>
      {editing && (
        <EntryEditor
          entry={editing === 'new' ? null : editing}
          groups={session.groups}
          defaultGroup={group !== 'all' ? group : session.groups[0]?.id}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null)
            setSelected(s.id)
            void load()
          }}
        />
      )}
    </div>
  )
}

function EntryDetail({ entry, groupName, code, isSuper, onEdit, onDeleted }: { entry: EntrySummary; groupName?: string; code?: TotpCode; isSuper: boolean; onEdit: () => void; onDeleted: () => void }) {
  const [shown, setShown] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const act = useAction()
  const toast = useToast()

  const copy = async (field: CopyField, label: string): Promise<void> => {
    const s = await act(() => unwrap(api.copy(entry.id, field)))
    if (s) toast(`${label} gekopieerd (wordt na ${s} s gewist).`)
  }

  return (
    <div className="detail">
      <header className="detail-head">
        <span className="avatar avatar-lg" aria-hidden="true">
          {entry.title.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '•'}
        </span>
        <div>
          <h2>{entry.title}</h2>
          <div className="muted small">
            {groupName} · bijgewerkt {new Date(entry.updatedAt).toLocaleDateString('nl-NL')}
          </div>
        </div>
        {isSuper && (
          <div className="detail-actions">
            <button className="btn btn-sm" onClick={onEdit}>
              <Icon name="edit" /> Bewerken
            </button>
            <button className="btn btn-sm btn-ghost-danger" onClick={() => setConfirmDelete(true)}>
              Verwijderen
            </button>
          </div>
        )}
      </header>

      <div className="fields">
        {entry.username && (
          <Field label="Gebruikersnaam">
            <span className="mono">{entry.username}</span>
            <button className="icon-btn" onClick={() => copy('username', 'Gebruikersnaam')} title="Kopiëren">
              <Icon name="copy" />
            </button>
          </Field>
        )}
        {entry.hasPassword && (
          <Field label="Wachtwoord">
            <span className="mono">{shown ?? '••••••••••••'}</span>
            <button
              className="icon-btn"
              title={shown ? 'Verbergen' : 'Tonen'}
              onClick={async () => {
                if (shown) setShown(null)
                else {
                  const pw = await act(() => unwrap(api.reveal(entry.id)))
                  if (pw !== undefined) setShown(pw)
                }
              }}
            >
              <Icon name={shown ? 'eyeoff' : 'eye'} />
            </button>
            <button className="icon-btn" onClick={() => copy('password', 'Wachtwoord')} title="Kopiëren">
              <Icon name="copy" />
            </button>
          </Field>
        )}
        {entry.hasPrivateKey && (
          <Field label="SSH-sleutel">
            <span className="muted">Staat versleuteld in de kluis en wordt alleen door de database-tunnel gebruikt.</span>
          </Field>
        )}
        {entry.hasTotp && code && (
          <Field label="2FA-code">
            <span className="totp mono">
              {code.code.slice(0, 3)} {code.code.slice(3)}
            </span>
            <span className={`timer ${code.secondsLeft <= 5 ? 'low' : ''}`} title={`Nog ${code.secondsLeft} seconden geldig`}>
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="15" className="timer-bg" />
                <circle cx="18" cy="18" r="15" className="timer-fg" strokeDasharray={`${(code.secondsLeft / code.period) * 94.2} 94.2`} />
              </svg>
              <span>{code.secondsLeft}</span>
            </span>
            <button className="icon-btn" onClick={() => copy('totp', '2FA-code')} title="Kopiëren">
              <Icon name="copy" />
            </button>
          </Field>
        )}
        {entry.urls.map((u) => (
          <Field label="Website" key={u}>
            <span className="url">{u}</span>
            <button className="icon-btn" title="Openen in browser" onClick={() => act(() => unwrap(api.openUrl(u)))}>
              <Icon name="link" />
            </button>
          </Field>
        ))}
        {entry.notes && (
          <Field label={entry.kind === 'note' ? 'Inhoud' : 'Notities'} block>
            {/* Secure notes bevatten vaak API-sleutels: standaard verbergen */}
            <Hidden text={entry.notes} hidden={entry.kind === 'note'} />
            <button className="icon-btn" onClick={() => copy('notes', 'Notitie')} title="Kopiëren">
              <Icon name="copy" />
            </button>
          </Field>
        )}
        {entry.extra && (
          <Field label="Overige velden" block>
            <Hidden text={entry.extra} hidden />
            <button className="icon-btn" onClick={() => copy('extra', 'Overige velden')} title="Kopiëren">
              <Icon name="copy" />
            </button>
          </Field>
        )}
      </div>
      {confirmDelete && (
        <Confirm
          title="Item verwijderen"
          text={<>Weet je zeker dat je <strong>{entry.title}</strong> wilt verwijderen? De vorige versie van de kluis blijft als back-up bewaard.</>}
          danger
          confirmLabel="Verwijderen"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false)
            const ok = await act(() => unwrap(api.deleteEntry(entry.id)).then(() => true), 'Item verwijderd.')
            if (ok) onDeleted()
          }}
        />
      )}
    </div>
  )
}

function Hidden({ text, hidden }: { text: string; hidden: boolean }) {
  const [show, setShow] = useState(!hidden)
  if (show) {
    return (
      <pre className="notes">
        {text}
        {hidden && (
          <>
            {'\n'}
            <button className="link-btn" onClick={() => setShow(false)}>
              Verbergen
            </button>
          </>
        )}
      </pre>
    )
  }
  return (
    <span>
      <span className="muted">Verborgen (kan geheime sleutels bevatten). </span>
      <button className="link-btn" onClick={() => setShow(true)}>
        Tonen
      </button>
    </span>
  )
}

function Field({ label, children, block }: { label: string; children: React.ReactNode; block?: boolean }) {
  return (
    <div className={`field-row ${block ? 'block' : ''}`}>
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
    </div>
  )
}

function EntryEditor({ entry, groups, defaultGroup, onClose, onSaved }: { entry: EditableEntry | null; groups: { id: string; name: string }[]; defaultGroup?: string; onClose: () => void; onSaved: (s: EntrySummary) => void }) {
  const [form, setForm] = useState({
    groupId: entry?.groupId ?? defaultGroup ?? '',
    title: entry?.title ?? '',
    kind: entry?.kind ?? ('login' as 'login' | 'note'),
    urls: entry?.urls.join('\n') ?? '',
    username: entry?.username ?? '',
    password: entry?.password ?? '',
    notes: entry?.notes ?? '',
    extra: entry?.extra ?? '',
    totpUri: entry?.totpUri ?? ''
  })
  const [showPw, setShowPw] = useState(false)
  const [qrChoices, setQrChoices] = useState<{ label: string; issuer: string; uri: string }[] | null>(null)
  const act = useAction()
  const fromQr = async (): Promise<void> => {
    const r = await act(() => unwrap(api.totpFromImage()))
    if (!r) return
    if (r.length === 1) setForm((f) => ({ ...f, totpUri: r[0].uri }))
    else setQrChoices(r)
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const input: EntryInput = {
      groupId: form.groupId,
      title: form.title,
      kind: form.kind,
      urls: form.urls.split(/\s+/).filter(Boolean),
      username: form.username,
      password: form.password,
      notes: form.notes,
      extra: form.extra,
      totpUri: form.totpUri
    }
    const saved = await act(() => unwrap(api.saveEntry(entry?.id ?? null, input)), 'Opgeslagen.')
    if (saved) onSaved(saved)
  }

  return (
    <Modal title={entry ? `Bewerken: ${entry.title}` : 'Nieuw item'} onClose={onClose} wide>
      <form onSubmit={save} className="grid-form">
        <label className="field">
          <span>Titel</span>
          <input value={form.title} onChange={set('title')} autoFocus required />
        </label>
        <label className="field">
          <span>Groep</span>
          <select value={form.groupId} onChange={set('groupId')}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Soort</span>
          <select value={form.kind} onChange={set('kind')}>
            <option value="login">Inlog</option>
            <option value="note">Notitie</option>
          </select>
        </label>
        <label className="field">
          <span>Gebruikersnaam</span>
          <input value={form.username} onChange={set('username')} />
        </label>
        <label className="field span2">
          <span>Wachtwoord</span>
          <div className="input-with-btns">
            <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')} className="mono" />
            <button type="button" className="btn btn-sm" onClick={() => setShowPw(!showPw)}>
              {showPw ? 'Verbergen' : 'Tonen'}
            </button>
            <button type="button" className="btn btn-sm" onClick={async () => setForm({ ...form, password: await api.generatePassword() })}>
              Genereren
            </button>
          </div>
        </label>
        <label className="field span2">
          <span>Websites (één per regel)</span>
          <textarea rows={2} value={form.urls} onChange={set('urls')} />
        </label>
        <label className="field span2">
          <span>2FA (otpauth://-link of sleutel; leeg = geen 2FA)</span>
          <div className="input-with-btns">
            <input value={form.totpUri} onChange={set('totpUri')} className="mono" />
            <button type="button" className="btn btn-sm" onClick={() => void fromQr()}>
              Uit QR-afbeelding…
            </button>
            {form.totpUri && (
              <button type="button" className="btn btn-sm" onClick={() => setForm({ ...form, totpUri: '' })}>
                Leegmaken
              </button>
            )}
          </div>
          {qrChoices && (
            <div className="qr-choices">
              <span className="muted small">Er staan {qrChoices.length} accounts in deze QR-code. Kies het juiste:</span>
              {qrChoices.map((c) => (
                <button
                  type="button"
                  key={c.uri}
                  className="btn btn-sm"
                  onClick={() => {
                    setForm((f) => ({ ...f, totpUri: c.uri }))
                    setQrChoices(null)
                  }}
                >
                  {c.issuer ? `${c.issuer}: ` : ''}
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </label>
        <label className="field span2">
          <span>Notities</span>
          <textarea rows={5} value={form.notes} onChange={set('notes')} />
        </label>
        <div className="row-end span2">
          <button type="button" className="btn" onClick={onClose}>
            Annuleren
          </button>
          <button className="btn btn-primary">Opslaan</button>
        </div>
      </form>
    </Modal>
  )
}
