import { useCallback, useEffect, useState } from 'react'
import type { RequirementStatus, SettingsView } from '../../shared/ipc'
import { api, unwrap } from './api'
import { useAction } from './ui'
import { SCRIPTS } from '../../shared/scripts'

export function ThisPc() {
  const [reqs, setReqs] = useState<RequirementStatus[] | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const act = useAction()

  const check = useCallback(() => {
    setReqs(null)
    void api.checkRequirements().then(setReqs)
  }, [])

  useEffect(() => {
    check()
    void api.getSettings().then(setSettings)
  }, [check])

  const save = async (s: SettingsView): Promise<void> => {
    const r = await act(() => unwrap(api.saveSettings(s)), 'Instellingen opgeslagen.')
    if (r) {
      setSettings(r)
      check()
    }
  }

  return (
    <div className="page">
      <header className="pane-head">
        <h1>Deze pc</h1>
        <button className="btn btn-sm" onClick={check}>
          Opnieuw controleren
        </button>
      </header>
      <p className="muted">
        De database-tunnel, de SQL-scripts, de linkchecker en de IPI-facturatie zitten in het dashboard zelf en hebben niets extra's nodig. Onderstaande programma's zijn alleen nodig voor de scripts die nog in Perl zijn:{' '}
        <strong>{SCRIPTS.filter((s) => s.kind === 'perl').map((s) => s.title).join(', ')}</strong>. Zodra die ook zijn ingebouwd, verdwijnt Perl van deze pagina.
      </p>

      <div className="card">
        {reqs === null ? (
          <p className="muted">Controleren…</p>
        ) : (
          <table className="table">
            <tbody>
              {reqs.map((r) => (
                <tr key={r.id}>
                  <td className="status">
                    <span className={`pill ${r.ok ? 'pill-ok' : 'pill-nok'}`}>{r.ok ? 'In orde' : 'Ontbreekt'}</span>
                  </td>
                  <td>
                    <div className="strong">{r.label}</div>
                    <div className="muted small">{r.help}</div>
                  </td>
                  <td className="muted small detail-cell">{r.detail}</td>
                  <td className="right">
                    {!r.ok && r.canInstall && (
                      <button className="btn btn-sm btn-primary" onClick={() => act(() => unwrap(api.installRequirement(r.id)), 'Installatievenster geopend.')}>
                        Installeren
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {settings && (
        <>
          <h2 className="section-title">Instellingen</h2>
          <div className="card stack">
            <label className="field">
              <span>Scriptmap (SharePoint "MT - Documents\Scripts")</span>
              <div className="input-with-btns">
                <input value={settings.scriptsRoot} onChange={(e) => setSettings({ ...settings, scriptsRoot: e.target.value })} />
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const p = await api.pickFolder()
                    if (p) setSettings({ ...settings, scriptsRoot: p })
                  }}
                >
                  Kiezen…
                </button>
              </div>
              {!settings.scriptsRootExists && <em className="form-error">Deze map bestaat niet op deze pc. Synchroniseer de SharePoint-bibliotheek of kies de juiste map.</em>}
            </label>
            <label className="field">
              <span>Map administratie ("Wefact automatisering")</span>
              <div className="input-with-btns">
                <input value={settings.adminRoot} onChange={(e) => setSettings({ ...settings, adminRoot: e.target.value })} />
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const p = await api.pickFolder()
                    if (p) setSettings({ ...settings, adminRoot: p })
                  }}
                >
                  Kiezen…
                </button>
              </div>
            </label>
            <div className="grid-form">
              <label className="field">
                <span>Tunnel: server</span>
                <input value={settings.tunnel.host} onChange={(e) => setSettings({ ...settings, tunnel: { ...settings.tunnel, host: e.target.value } })} />
              </label>
              <label className="field">
                <span>Tunnel: gebruiker</span>
                <input value={settings.tunnel.user} onChange={(e) => setSettings({ ...settings, tunnel: { ...settings.tunnel, user: e.target.value } })} />
              </label>
              <label className="field">
                <span>Database</span>
                <input value={settings.tunnel.database} onChange={(e) => setSettings({ ...settings, tunnel: { ...settings.tunnel, database: e.target.value } })} />
              </label>
              <label className="field">
                <span>Lokale poort voor losse scripts</span>
                <input type="number" value={settings.tunnel.localPort} onChange={(e) => setSettings({ ...settings, tunnel: { ...settings.tunnel, localPort: Number(e.target.value) } })} />
              </label>
            </div>
            <div className="row-end">
              <button className="btn btn-primary" onClick={() => void save(settings)}>
                Opslaan
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
