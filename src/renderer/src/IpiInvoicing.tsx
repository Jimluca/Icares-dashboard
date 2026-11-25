import { useEffect, useState } from 'react'
import { amounts, euro, padNr, type IpiConfig, type IpiOrg, type IpiPreview, type IpiSendResult } from '../../shared/ipi'
import { api, unwrap } from './api'
import { ResultTable } from './Data'
import { Confirm, Icon, useAction } from './ui'

export function IpiInvoicing() {
  const [cfg, setCfg] = useState<IpiConfig | null>(null)
  const [isSuper, setIsSuper] = useState(false)
  const [test, setTest] = useState(true)
  const [testAddress, setTestAddress] = useState('')
  const [preview, setPreview] = useState<IpiPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [result, setResult] = useState<IpiSendResult | null>(null)
  const act = useAction()

  useEffect(() => {
    void api.session().then((s) => setIsSuper(s?.role === 'superadmin'))
    void act(() => unwrap(api.ipiConfig())).then((c) => {
      if (c) {
        setCfg(c)
        setTestAddress(c.testAddress)
      }
    })
    return api.onIpiLog((l) => setLog((x) => [...x, l]))
  }, [act])

  const load = async (): Promise<void> => {
    setLoading(true)
    const p = await act(() => unwrap(api.ipiPreview()))
    setLoading(false)
    if (p) setPreview(p)
  }

  return (
    <div className="stack">
      <div className={`card stack ipi-mode ${test ? 'is-test' : 'is-live'}`}>
        <label className="check strong">
          <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
          Testmodus {test ? '(aan)' : '(UIT: facturen gaan echt naar klanten)'}
        </label>
        {test ? (
          <>
            <p className="muted small">Er wordt niets in de database gewijzigd. Testfacturen komen in een lokale testmap en álle mails (klant, kopie en ter info) gaan alleen naar dit adres:</p>
            <div className="input-with-btns">
              <input placeholder="jouw e-mailadres" value={testAddress} onChange={(e) => setTestAddress(e.target.value)} />
              {isSuper && cfg && (
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const c = await act(() => unwrap(api.ipiSetConfig({ testAddress })), 'Testadres opgeslagen.')
                    if (c) setCfg(c)
                  }}
                >
                  Als standaard bewaren
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="small">
            Echte factuurnummers worden vastgelegd in de database, facturen komen in SharePoint, en mails gaan naar de klant, <strong>invoices@icares.nl</strong> en ter info naar <strong>{cfg?.infoRecipients.join(', ')}</strong>.
          </p>
        )}
      </div>

      <div className="row-wrap">
        <button className="btn btn-primary" disabled={loading} onClick={() => void load()}>
          {loading ? 'Ophalen…' : preview ? 'Vernieuwen' : 'Nieuwe cliënten ophalen'}
        </button>
        {preview && (
          <span className="muted small">
            Volgend factuurnummer: <strong>IPI{padNr(preview.nextInvoiceNr)}</strong> · map: {preview.invoiceFolderExists ? preview.invoiceFolder : <span className="form-error">SharePoint-map niet gevonden</span>}
          </span>
        )}
      </div>

      {preview && preview.orgs.length === 0 && <div className="notice notice-ok">Er zijn geen nieuwe IPI-cliënten zonder factuur.</div>}
      {preview?.orgs.map((o) => (
        <OrgCard
          key={o.orgId}
          org={o}
          firstNr={preview.nextInvoiceNr}
          test={test}
          testAddress={testAddress}
          onSent={(r) => {
            setResult(r)
            if (!r.test) void load()
          }}
          onStart={() => {
            setLog([])
            setResult(null)
          }}
        />
      ))}

      {log.length > 0 && (
        <div className="card">
          <h3>Verloop</h3>
          <ul className="log">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {result && <ResultBlock result={result} />}
    </div>
  )
}

function OrgCard({ org, firstNr, test, testAddress, onSent, onStart }: { org: IpiOrg; firstNr: number; test: boolean; testAddress: string; onSent: (r: IpiSendResult) => void; onStart: () => void }) {
  const [email, setEmail] = useState(org.billingEmail)
  const [salutation, setSalutation] = useState(org.salutations[0] ?? '')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const act = useAction()
  const a = amounts(org.priceExcl)
  const n = org.clients.length

  const send = async (): Promise<void> => {
    setConfirm(false)
    onStart()
    setBusy(true)
    const r = await act(() => unwrap(api.ipiSend({ orgId: org.orgId, userIds: org.clients.map((c) => c.userId), billingEmail: email, salutation, test, testAddress })))
    setBusy(false)
    if (r) onSent(r)
  }

  return (
    <div className="card stack org-card">
      <div className="row-between">
        <div>
          <h2>{org.invoiceName}</h2>
          <div className="muted small">
            org-id {org.orgId}
            {org.invoiceName !== org.name && ` · in de database: ${org.name}`} · debiteur D{org.debNr} · {org.addressLine}, {org.postalCityLine}
          </div>
        </div>
        <div className="right">
          <div className="strong">
            {n} {n === 1 ? 'factuur' : 'facturen'} × € {euro(a.total)}
          </div>
          <div className="muted small">€ {euro(a.excl)} excl. btw</div>
        </div>
      </div>
      {org.problems.length > 0 && <div className="notice notice-warn">{org.problems.join(' ')}</div>}
      <table className="data">
        <thead>
          <tr>
            <th>Nr (verwacht)</th>
            <th>user-id</th>
            <th>Voornaam</th>
            <th>Tussenv.</th>
            <th>Achternaam</th>
            <th>E-mail cliënt</th>
          </tr>
        </thead>
        <tbody>
          {org.clients.map((c, i) => (
            <tr key={c.userId}>
              <td>IPI{padNr(firstNr + i)}</td>
              <td>{c.userId}</td>
              <td>{c.firstname}</td>
              <td>{c.middlename}</td>
              <td>{c.lastname}</td>
              <td>{c.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid-form">
        <label className="field">
          <span>Factuur mailen naar</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Aanhef: "Beste …,"</span>
          <select value={salutation} onChange={(e) => setSalutation(e.target.value)}>
            {org.salutations.length === 0 && <option value="">(geen contactpersoon bekend)</option>}
            {org.salutations.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row-wrap">
        <button className="btn" onClick={() => act(() => unwrap(api.ipiSamplePdf(org.orgId)))}>
          <Icon name="doc" /> Voorbeeldfactuur bekijken
        </button>
        <button className={`btn ${test ? 'btn-primary' : 'btn-danger'}`} disabled={busy || (!test && org.problems.length > 0)} onClick={() => (test ? void send() : setConfirm(true))}>
          <Icon name="play" /> {busy ? 'Bezig…' : test ? `Testfacturen maken en naar ${testAddress || '…'} mailen` : 'Facturen maken en versturen'}
        </button>
      </div>
      {confirm && (
        <Confirm
          title="Echte facturen versturen?"
          danger
          confirmLabel={`Ja, ${n} ${n === 1 ? 'factuur' : 'facturen'} versturen`}
          onClose={() => setConfirm(false)}
          onConfirm={() => void send()}
          text={
            <>
              <p>
                Voor <strong>{org.invoiceName}</strong> worden {n} {n === 1 ? 'factuur' : 'facturen'} gemaakt (vanaf <strong>IPI{padNr(firstNr)}</strong>, à € {euro(a.total)} incl. btw) en de nummers worden vastgelegd in de database.
              </p>
              <p>
                De mail gaat naar <strong>{email}</strong> met aanhef "Beste {salutation},". Dit kun je niet ongedaan maken.
              </p>
            </>
          }
        />
      )}
    </div>
  )
}

function ResultBlock({ result }: { result: IpiSendResult }) {
  const act = useAction()
  return (
    <div className="card stack">
      <h3>{result.test ? 'Resultaat testrun' : 'Resultaat'}: {result.orgName}</h3>
      {result.warnings.map((w) => (
        <div key={w} className="notice notice-warn">
          {w}
        </div>
      ))}
      {result.mailed ? (
        <div className="notice notice-ok">{result.test ? 'Testmails verstuurd. Controleer je inbox.' : 'Facturen gemaakt, genummerd en verstuurd.'}</div>
      ) : (
        <button className="btn btn-primary" onClick={() => act(() => unwrap(api.ipiResend(result.runId)), 'Opnieuw gemaild.')}>
          Opnieuw mailen
        </button>
      )}
      <ul className="plain">
        {result.invoices.map((inv) => (
          <li key={inv.pdf}>
            IPI{inv.nr} (user-id {inv.userId}):{' '}
            <button className="link-btn" onClick={() => act(() => unwrap(api.ipiOpenFile(inv.pdf)))}>
              pdf
            </button>{' '}
            ·{' '}
            <button className="link-btn" onClick={() => act(() => unwrap(api.ipiOpenFile(inv.xlsx)))}>
              Excel
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">Regels voor __openstaande_IPI_facturen.xlsx{result.test ? ' (in testmodus niet toegevoegd)' : ''}:</p>
      <ResultTable result={{ ...result.overviewRows, truncated: false, ms: 0 }} name={`IPI ${result.orgName}`} />
    </div>
  )
}
