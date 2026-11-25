import type { Api } from '../../shared/ipc'
import type { Result } from '../../shared/types'

declare global {
  interface Window {
    icares: Api
  }
}

export const api = window.icares

/** Pakt een Result uit; gooit bij een fout zodat de aanroeper een melding kan tonen. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.value
}
