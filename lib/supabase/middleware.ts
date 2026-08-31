import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { publicSupabaseConfig } from '@/lib/env'
import type { Database } from '@/types/database'

const PROTECTED_PREFIXES = ['/inbox', '/knowledge-base', '/analytics', '/settings']
const AUTH_ONLY_PATHS = ['/login', '/signup']

/**
 * Refreshes the auth cookie on every request and gates the dashboard routes.
 *
 * This is a first line of defence for UX, not the security boundary — RLS is.
 * A request that slips past it still cannot read another workspace's rows.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })
  const { url, anonKey } = publicSupabaseConfig()

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // getUser() revalidates the token with Supabase; getSession() would trust the
  // cookie as-is. Do not swap it out.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname, search } = request.nextUrl

  if (!user && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', `${pathname}${search}`)
    return redirectPreservingCookies(loginUrl, response)
  }

  if (user && AUTH_ONLY_PATHS.includes(pathname)) {
    return redirectPreservingCookies(new URL('/inbox', request.url), response)
  }

  return response
}

/** A redirect discards the body but must keep the refreshed session cookies. */
function redirectPreservingCookies(destination: URL, source: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(destination)
  for (const cookie of source.cookies.getAll()) {
    redirect.cookies.set(cookie)
  }
  return redirect
}
