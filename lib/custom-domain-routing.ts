import { NextResponse, type NextRequest } from 'next/server'

import { customDomainAction, isAppHost, isPassThroughPath } from '@/lib/custom-domain'
import { resolveDomainRoute } from '@/lib/custom-domain-lookup'
import { appUrl } from '@/lib/env'

/**
 * Serves a workspace's public help centre at its own hostname.
 *
 * Returns null when the request is not a custom-domain request, so the caller
 * carries on with the normal session pipeline. Returns a response when this
 * layer has decided the outcome — a rewrite into /kb/[workspaceSlug], a
 * canonicalising redirect, or a refusal.
 *
 * Unlike the dashboard gating in lib/supabase/middleware.ts, this is a real
 * security boundary rather than a UX one: RLS cannot back it up, because the
 * published articles a custom domain serves are readable by `anon` by design.
 * Whether a given hostname may serve them at all is decided here and nowhere
 * else, which is why the decision itself lives in lib/custom-domain.ts as a
 * pure function with tests.
 */
export async function routeCustomDomain(request: NextRequest): Promise<NextResponse | null> {
  const host = requestHost(request)
  if (!host || isAppHost(host, appHost())) return null

  const { pathname } = request.nextUrl
  if (isPassThroughPath(pathname)) return null

  const route = await resolveDomainRoute(host)
  const action = customDomainAction(pathname, route)

  switch (action.kind) {
    case 'passthrough':
      return null

    case 'block':
      return refuse()

    case 'redirect': {
      const target = new URL(request.nextUrl)
      target.pathname = action.pathname
      // Pinned to the Host header we resolved, so the browser is never bounced
      // off the custom domain onto whatever host nextUrl happened to carry.
      target.host = host
      return NextResponse.redirect(target, 307)
    }

    case 'rewrite': {
      const target = new URL(request.nextUrl)
      target.pathname = action.pathname
      return NextResponse.rewrite(target)
    }
  }
}

/**
 * Deliberately not the app's own 404 page: an unverified or unroutable hostname
 * should get no branding, no navigation, and nothing that hints at which
 * workspace, if any, claimed it.
 *
 * no-store matters here. A cached refusal would survive the verification that
 * makes the domain valid, and a cached anything would survive the disconnect
 * that makes it invalid.
 */
function refuse(): NextResponse {
  return new NextResponse('Not found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Lowercased, port stripped, so it compares directly against custom_domain. */
function requestHost(request: NextRequest): string | null {
  const header = request.headers.get('host')
  if (!header) return null
  return header.trim().toLowerCase().replace(/:\d+$/, '')
}

function appHost(): string {
  try {
    return new URL(appUrl()).hostname
  } catch {
    return ''
  }
}
