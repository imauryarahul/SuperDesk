import 'server-only'

import { vercelConfig } from '@/lib/env'

/**
 * The slice of the Vercel Domains API custom domains needs: attach a domain to
 * this project, ask whether Vercel considers it verified, and ask what DNS it
 * wants. Nothing here writes to our own database — the caller owns that, so the
 * "did Vercel say yes" decision and the "may we serve this" decision stay in
 * separate places.
 */

const API_BASE = 'https://api.vercel.com'

/**
 * Same ceiling as the OpenAI calls, and for the same reason: this runs inside a
 * server action a human is waiting on, so a slow upstream has to become an
 * error message rather than a hung page.
 */
const TIMEOUT_MS = 8_000

export class VercelApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'VercelApiError'
  }
}

export type DnsRecordType = 'A' | 'CNAME' | 'TXT'

/** One row of the "add these records at your DNS provider" table in settings. */
export type DnsRecord = {
  type: DnsRecordType
  /** Host/name field as the DNS provider wants it: '@' for the apex, else the subdomain label. */
  name: string
  value: string
  note?: string
}

export type ProjectDomain = {
  name: string
  apexName: string
  verified: boolean
  /** Ownership challenges Vercel wants satisfied before it will verify. */
  verification: { type: string; domain: string; value: string; reason: string }[]
}

export type DomainConfig = {
  /** True while Vercel cannot yet issue a certificate for the domain. */
  misconfigured: boolean
  configuredBy: 'A' | 'CNAME' | 'http' | 'dns-01' | null
  recommendedIPv4: { rank: number; value: string[] }[]
  recommendedCNAME: { rank: number; value: string }[]
}

type RawProjectDomain = {
  name?: unknown
  apexName?: unknown
  verified?: unknown
  verification?: unknown
}

type RawDomainConfig = {
  misconfigured?: unknown
  configuredBy?: unknown
  recommendedIPv4?: unknown
  recommendedCNAME?: unknown
}

async function vercelFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token, projectId, teamId } = vercelConfig()
  const url = new URL(path.replace('{projectId}', encodeURIComponent(projectId)), API_BASE)
  if (teamId) url.searchParams.set('teamId', teamId)

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
    throw new VercelApiError(
      0,
      timedOut ? 'timeout' : 'network_error',
      timedOut ? `Vercel did not respond within ${TIMEOUT_MS}ms.` : 'Could not reach Vercel.',
    )
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const error =
      body && typeof body === 'object' && 'error' in body
        ? (body as { error: { code?: unknown; message?: unknown } }).error
        : null
    throw new VercelApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'unknown',
      typeof error?.message === 'string' ? error.message : `Vercel returned ${response.status}.`,
    )
  }

  return body as T
}

function toProjectDomain(raw: RawProjectDomain): ProjectDomain {
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    // Vercel omits apexName on some shapes; the domain is its own apex then.
    apexName: typeof raw.apexName === 'string' ? raw.apexName : String(raw.name ?? ''),
    verified: raw.verified === true,
    verification: Array.isArray(raw.verification)
      ? raw.verification.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const { type, domain, value, reason } = entry as Record<string, unknown>
          if (typeof type !== 'string' || typeof domain !== 'string' || typeof value !== 'string') {
            return []
          }
          return [{ type, domain, value, reason: typeof reason === 'string' ? reason : '' }]
        })
      : [],
  }
}

/**
 * Adds the domain to this Vercel project. Idempotent by design: a domain
 * already attached to *this* project comes back as a success, because an admin
 * retrying a submit after a timeout should not be told their own domain is
 * taken. A domain attached to someone else's project still errors.
 */
export async function addProjectDomain(domain: string): Promise<ProjectDomain> {
  try {
    const raw = await vercelFetch<RawProjectDomain>('/v10/projects/{projectId}/domains', {
      method: 'POST',
      body: JSON.stringify({ name: domain }),
    })
    return toProjectDomain(raw)
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 409) {
      const existing = await getProjectDomain(domain)
      if (existing) return existing
    }
    throw error
  }
}

/** Null when the domain is not attached to this project. */
export async function getProjectDomain(domain: string): Promise<ProjectDomain | null> {
  try {
    const raw = await vercelFetch<RawProjectDomain>(
      `/v9/projects/{projectId}/domains/${encodeURIComponent(domain)}`,
    )
    return toProjectDomain(raw)
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 404) return null
    throw error
  }
}

export async function removeProjectDomain(domain: string): Promise<void> {
  try {
    await vercelFetch(`/v9/projects/{projectId}/domains/${encodeURIComponent(domain)}`, {
      method: 'DELETE',
    })
  } catch (error) {
    // Already gone is the state we wanted.
    if (error instanceof VercelApiError && error.status === 404) return
    throw error
  }
}

export async function getDomainConfig(domain: string): Promise<DomainConfig> {
  const raw = await vercelFetch<RawDomainConfig>(
    `/v6/domains/${encodeURIComponent(domain)}/config`,
  )

  return {
    // Absent is treated as misconfigured: this only ever gates optimism in the UI.
    misconfigured: raw.misconfigured !== false,
    configuredBy:
      raw.configuredBy === 'A' ||
      raw.configuredBy === 'CNAME' ||
      raw.configuredBy === 'http' ||
      raw.configuredBy === 'dns-01'
        ? raw.configuredBy
        : null,
    recommendedIPv4: Array.isArray(raw.recommendedIPv4)
      ? raw.recommendedIPv4.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const { rank, value } = entry as Record<string, unknown>
          const ips = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
          if (ips.length === 0) return []
          return [{ rank: typeof rank === 'number' ? rank : Number.MAX_SAFE_INTEGER, value: ips }]
        })
      : [],
    recommendedCNAME: Array.isArray(raw.recommendedCNAME)
      ? raw.recommendedCNAME.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const { rank, value } = entry as Record<string, unknown>
          if (typeof value !== 'string' || value.length === 0) return []
          return [{ rank: typeof rank === 'number' ? rank : Number.MAX_SAFE_INTEGER, value }]
        })
      : [],
  }
}

/**
 * The records an admin has to create, taken from what Vercel actually returned
 * rather than from the general-purpose values in Vercel's docs — those are not
 * always right for a given project, and the point of showing them here is that
 * the admin never has to go look them up.
 *
 * Two kinds appear. Ownership challenges (usually a TXT on _vercel) show up
 * only when Vercel needs proof, e.g. the apex is already registered to another
 * Vercel account. The pointing record is always needed: an A record for an apex
 * domain, a CNAME for a subdomain, because a CNAME at the apex would collide
 * with the zone's own SOA/NS records.
 */
export function dnsRecordsFor(domain: ProjectDomain, config: DomainConfig): DnsRecord[] {
  const records: DnsRecord[] = domain.verification.map((entry) => ({
    type: entry.type.toUpperCase() === 'CNAME' ? 'CNAME' : 'TXT',
    name: entry.domain,
    value: entry.value,
    note: 'Proves you own the domain.',
  }))

  const isApex = domain.name === domain.apexName
  const preferred = <T extends { rank: number }>(entries: T[]): T | undefined =>
    [...entries].sort((a, b) => a.rank - b.rank)[0]

  if (isApex) {
    const ipv4 = preferred(config.recommendedIPv4)
    if (ipv4?.value[0]) {
      records.push({ type: 'A', name: '@', value: ipv4.value[0] })
    }
  } else {
    const cname = preferred(config.recommendedCNAME)
    if (cname) {
      records.push({
        type: 'CNAME',
        name: subdomainLabel(domain.name, domain.apexName),
        value: cname.value,
      })
    }
  }

  return records
}

/** 'help.acme.com' under apex 'acme.com' is entered as 'help' at most providers. */
function subdomainLabel(name: string, apexName: string): string {
  return name.endsWith(`.${apexName}`) ? name.slice(0, -(apexName.length + 1)) : name
}
