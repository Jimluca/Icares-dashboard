import { useState } from 'react'
import { FONTYS_DEFAULTS, type FontysAction, type FontysPlan, type FontysResult, type FontysSettings } from '../../shared/fontys'
import { api, unwrap } from './api'
import { Confirm, Icon, useAction, useToast } from './ui'

const LABEL: Record<FontysAction, string> = { nieuw: 'Nieuw', subadres: 'Subadres + nieuw', bestaat: 'Bestaat al', fout: 'Fout' }

export function FontysImport() {
  const [settings, setSettings] = useState<FontysSettings>(FONTYS_DEFAULTS)
  const [file, setFile] = useState<string | null>(null)
  const [plan, setPlan] = useState<FontysPlan | null>(null)
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<FontysResult | null>(null)
  const act = useAction()
  const toast = useToast()

  const check = async (f = file): Promise<void> => {
    if (!f) return
    setBusy('plan')
    setResult(null)
    const p = await act(() => unwrap(api.fontysPlan(f, settings)))
    setBusy(null)
    if (p) setPlan(p)
  }

  const pick = async (): Promise<void> => {
    const f = await act(() => unwrap(api.fontysPickExcel()))
    if (f) {
      setFile(f)
      await check(f)
    }
  }

  const apply = async (): Promise<void> => {
    setConfirm(false)
    setBusy('apply')
    const r = await act(() => unwrap(api.fontysApply()))
    setBusy(null)
    if (r) {
      setResult(r)
      setPlan(null)
      toast(`${r.created} account(s) aangemaakt.`)
    } else if (file) {
      await check(file) // toon het bijgewerkte overzicht als er iets veranderd was
    }
  }

  const count = (a: FontysAction): number => plan?.rows.filter((r) => r.action === a).length ?? 0
  const toCreate = count('nieuw') + count('subadres')
  const num = (k: keyof FontysSettings) => ({
    value: settings[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, [k]: Number(e.target.value) }),
    type: 'number' as const
  })

  return (
    <div className="stack">
      <div className="card stack">
        <div className="grid-form">
          <label className="field">
            <span>Organisatie-id (standaard 275, IMK)</span>
            <input {...num('organizationId')} />
          </label>
          <label className="field">
            <span>Aangemaakt door (user-id organisatiemanager)</span>
            <input {...num('createdBy')} />
          </label>
        </div>
        <details>
          <summary className="muted small">Meer instellingen (land en taal)</summary>
          <div className="grid-form" style={{ marginTop: 10 }}>
            <label className="field">
              <span>country_region_id</span>
              <input {...num('countryRegionId')} />
            </label>
            <label className="field">
              <span>country_id</span>
              <input {...num('countryId')} />
            </label>
            <label className="field">
              <span>language_id</span>
              <input {...num('languageId')} />
            </label>
          </div>
        </details>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => void pick()}>
            <Icon name="doc" /> Excel-bestand kiezen…
          </button>
          {file && (
            <>
              <span className="muted small mono">{file.split('\\').pop()}</span>
              <button className="btn btn-sm" disabled={busy !== null} onClick={() => void check()}>
                {busy === 'plan' ? 'Controleren…' : 'Opnieuw controleren'}
              </button>
            </>
          )}
        </div>
      </div>

      {result && (
        <div className="notice notice-ok">
          {result.created} student(en) aangemaakt als professional{result.readdressed ? `, ${result.readdressed} bestaand(e) account(s) kregen een subadres` : ''}. Beginwachtwoord: het studentnummer achterstevoren.
        </div>
      )}

      {plan && (
        <>
          <div className="notice notice-ok">
            Organisatie <strong>{plan.organizationName}</strong> ({plan.settings.organizationId}) · aangemaakt door <strong>{plan.createdByName}</strong>
          </div>
          <div className="row-wrap">
            <span className="pill pill-ok">{count('nieuw')} nieuw</span>
            {count('subadres') > 0 && <span className="pill pill-super">{count('subadres')} subadres + nieuw</span>}
            {count('bestaat') > 0 && <span className="pill">{count('bestaat')} bestaat al</span>}
            {count('fout') > 0 && <span className="pill pill-nok">{count('fout')} met fout (worden overgeslagen)</span>}
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Regel</th>
                  <th>Studentnr</th>
                  <th>E-mail</th>
                  <th>Naam</th>
                  <th>Wat gebeurt er</th>
                  <th>Toelichting</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={`${r.row}-${r.email}`} className={r.action === 'fout' ? 'bad' : ''}>
                    <td>{r.row}</td>
                    <td>{r.studentNr}</td>
                    <td>{r.email}</td>
                    <td>
                      {r.firstname} {r.lastname}
                    </td>
                    <td className="strong">{LABEL[r.action]}</td>
                    <td title={r.message}>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-wrap">
            <button className="btn btn-danger" disabled={busy !== null || toCreate === 0} onClick={() => setConfirm(true)}>
              {busy === 'apply' ? 'Bezig…' : `Accounts aanmaken (${toCreate})`}
            </button>
            <button
              className="btn"
              disabled={busy !== null || toCreate === 0}
              onClick={async () => {
                const p = await act(() => unwrap(api.fontysSaveSql()))
                if (p) toast(`SQL-bestand opgeslagen: ${p}`)
              }}
            >
              Alleen SQL-bestand maken
            </button>
          </div>
        </>
      )}

      {confirm && plan && (
        <Confirm
          title="Accounts aanmaken?"
          danger
          confirmLabel={`Ja, ${toCreate} account(s) aanmaken`}
          onClose={() => setConfirm(false)}
          onConfirm={() => void apply()}
          text={
            <>
              <p>
                Er worden <strong>{toCreate}</strong> studenten aangemaakt als professional bij <strong>{plan.organizationName}</strong>.
              </p>
              {count('subadres') > 0 && <p>{count('subadres')} bestaand(e) account(s) krijgen eerst een subadres (bijv. +client) zodat het e-mailadres vrij komt.</p>}
              {count('fout') + count('bestaat') > 0 && <p className="muted">{count('fout') + count('bestaat')} regel(s) worden overgeslagen.</p>}
              <p>Gaat er onderweg iets mis, dan wordt niets aangepast.</p>
            </>
          }
        />
      )}
    </div>
  )
}
