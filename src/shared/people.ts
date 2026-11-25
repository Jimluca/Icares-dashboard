// Personen verwijderen uit Icares Professional.

export interface OrgSearchHit {
  id: number
  name: string
  people: number
}

export interface OrgPerson {
  id: number
  role: string // 'organization manager' | 'professional' | 'client' | ...
  status: string
  name: string
  email: string
  createdAt: string
  /** Aantal gekoppelde cliënten (bij professionals). */
  clients: number
  /** E-mail van gekoppelde professional(s) (bij cliënten). */
  professionals: string
}

export interface DeleteOutcome {
  userId: number
  name: string
  role: string
}

/** Alleen deze rollen kunnen via het dashboard verwijderd worden (geen beheerders). */
export const DELETABLE_ROLES = ['organization manager', 'professional', 'client']

/** Bij deze rollen kun je de status wijzigen (bijv. op non-actief zetten). */
export const STATUS_ROLES = ['organization manager', 'professional']

export const STATUS_LABEL: Record<string, string> = {
  active: 'Actief',
  inactive: 'Non-actief',
  blocked: 'Geblokkeerd',
  pending: 'In afwachting',
  deleted: 'Verwijderd'
}

export const ROLE_LABEL: Record<string, string> = {
  'organization manager': 'Organisatiemanager',
  professional: 'Professional',
  client: 'Cliënt'
}
