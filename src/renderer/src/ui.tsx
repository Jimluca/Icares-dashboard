import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

// ---------- meldingen ----------
interface Toast {
  id: number
  text: string
  kind: 'ok' | 'error'
}
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {})
export const useToast = (): ((text: string, kind?: 'ok' | 'error') => void) => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/** Voert een actie uit en toont een foutmelding als die misgaat. */
export function useAction(): <T>(fn: () => Promise<T>, okText?: string) => Promise<T | undefined> {
  const toast = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string) => {
      try {
        const v = await fn()
        if (okText) toast(okText)
        return v
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
        return undefined
      }
    },
    [toast]
  )
}

// ---------- modal ----------
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Sluiten">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Confirm({ title, text, danger, confirmLabel, onConfirm, onClose }: { title: string; text: ReactNode; danger?: boolean; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm-text">{text}</div>
      <div className="row-end">
        <button className="btn" onClick={onClose}>
          Annuleren
        </button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Icon({ name }: { name: 'lock' | 'key' | 'terminal' | 'pc' | 'shield' | 'copy' | 'eye' | 'eyeoff' | 'link' | 'edit' | 'plus' | 'folder' | 'doc' | 'play' | 'search' | 'clock' | 'logout' }) {
  const paths: Record<string, string> = {
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
    key: 'M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z',
    terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h4',
    pc: 'M3 5h18v11H3zM8 20h8M12 16v4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
    link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
    edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    plus: 'M12 5v14M5 12h14',
    folder: 'M3 6h6l2 2h10v11H3z',
    doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
    play: 'M7 4l13 8-13 8z',
    search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l5 5',
    clock: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2',
    logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10'
  }
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
