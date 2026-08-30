import type { NextRequest } from 'next/server'

import { routeCustomDomain } from '@/lib/custom-domain-routing'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  // Custom domains are resolved first and, when they match, answered here: a
  // request arriving on a workspace's own hostname is either its public help
  // centre or refused, and either way it has no session to refresh.
  const customDomain = await routeCustomDomain(request)
  if (customDomain) return customDomain

  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The session cookie has
     * to be refreshed on page navigations, not on asset fetches.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
