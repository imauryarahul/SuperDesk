/**
 * Pure logic behind custom-domain routing. No imports on purpose: this module
 * is loaded into the Edge middleware bundle and exercised directly by
 * scripts/custom-domain.test.mjs, and the decision it encodes — which requests
 * on a customer-owned hostname are allowed to reach a workspace's help centre —
 * is the security property of the feature, so it should be readable and
 * testable without a request, a database, or a Next.js runtime in the way.
 */

/**
 * Mirrors the workspaces_custom_domain_format check constraint. Bare hostnames
 * only: lowercase, at least one dot, no scheme, port, path, or trailing dot.
 */
export const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/**
 * Reduces whatever an admin pasted into settings to the bare hostname the Host
 * header will actually carry, or null if it cannot be one. Admins paste URLs,
 * so accepting 'https://help.acme.com/' is worth ten lines here rather than a
 * validation error they have to interpret.
 */
export function normalizeDomain(input: string): string | null {
  const withoutScheme = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const host = (withoutScheme.split(/[/?#]/)[0] ?? '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')

  return HOSTNAME_PATTERN.test(host) ? host : null
}

/**
 * Hostnames a workspace must not be allowed to claim, because claiming one
 * would let a customer's settings form take over the app itself.
 * Returns an admin-facing reason, or null when the domain is claimable.
 */
export function unclaimableDomainReason(domain: string, appHost: string): string | null {
  if (domain === appHost) {
    return 'That is this app\u2019s own domain.'
  }
  if (domain === 'vercel.app' || domain.endsWith('.vercel.app')) {
    return 'Vercel deployment domains cannot be used as a custom domain.'
  }
  if (domain.endsWith('.localhost') || domain.endsWith('.local') || domain.endsWith('.internal')) {
    return 'That is not a public domain.'
  }
  return null
}

/** True when the Host header belongs to the app itself rather than a customer. */
export function isAppHost(host: string, appHost: string): boolean {
  return (
    host === appHost ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.vercel.app')
  )
}

/**
 * Requests that must reach the app untouched even on a customer's hostname:
 * the build assets the help centre pages need in order to render, and the ACME
 * challenge path, because breaking that would break the certificate renewal
 * that makes the domain work in the first place.
 */
export function isPassThroughPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/.well-known/') ||
    pathname === '/favicon.ico' ||
    pathname === '/widget.js'
  )
}

/**
 * Top-level paths that belong to the dashboard, auth, or the API. On a custom
 * domain they are refused rather than proxied: a customer-controlled hostname
 * serving our login page and our API under its own origin would hand that
 * customer a same-origin foothold on other tenants' sessions for free. The
 * public help centre is the entire surface a custom domain gets.
 */
const RESERVED_SEGMENTS = new Set([
  'api',
  'auth',
  'inbox',
  'invite',
  'kb',
  'knowledge-base',
  'login',
  'settings',
  'signup',
])

export type DomainRoute =
  /** Host matches a workspace whose custom_domain_status is 'verified'. */
  | { status: 'verified'; workspaceSlug: string }
  /** Host matches a workspace's custom_domain, but it is pending or errored. */
  | { status: 'unverified' }
  /** No workspace has claimed this host. */
  | { status: 'unclaimed' }

export type RouteAction =
  /** Hand the request to the normal app pipeline. */
  | { kind: 'passthrough' }
  /** Serve a bare 404. Nothing about any workspace may be revealed. */
  | { kind: 'block' }
  | { kind: 'rewrite'; pathname: string }
  | { kind: 'redirect'; pathname: string }

/**
 * What to do with a request on a non-app hostname. Callers must have already
 * filtered out isPassThroughPath(), so every path reaching here is content.
 *
 * The one line that matters: anything other than 'verified' blocks. A domain a
 * workspace has merely claimed must not resolve to that workspace's help centre
 * (they may not own it) and must not resolve to anyone else's either, so there
 * is no state in which an unverified claim serves content.
 */
export function customDomainAction(pathname: string, route: DomainRoute): RouteAction {
  // Not claimed by any workspace, so this is not ours to reinterpret — some
  // other alias may legitimately point at this deployment.
  if (route.status === 'unclaimed') return { kind: 'passthrough' }

  if (route.status !== 'verified') return { kind: 'block' }

  const base = `/kb/${route.workspaceSlug}`

  // The help centre pages link to absolute /kb/<slug>/... paths. On this
  // hostname those are the same content one level too deep, so send the browser
  // to the canonical root-relative URL instead of serving both. 307, not 308,
  // because a permanently cached redirect would outlive the domain itself.
  if (pathname === base || pathname.startsWith(`${base}/`)) {
    return { kind: 'redirect', pathname: pathname.slice(base.length) || '/' }
  }

  if (pathname === '/') return { kind: 'rewrite', pathname: base }

  // The help centre is exactly two levels deep: an index and article slugs.
  const segments = pathname.slice(1).split('/')
  const slug = segments[0]
  if (segments.length !== 1 || !slug || RESERVED_SEGMENTS.has(slug)) {
    return { kind: 'block' }
  }

  return { kind: 'rewrite', pathname: `${base}/${slug}` }
}
