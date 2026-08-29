// Next.js only inlines NEXT_PUBLIC_* vars when they are read as static member
// expressions, so these two cannot be looked up dynamically by name.
const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const publicAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export type PublicSupabaseConfig = { url: string; anonKey: string }

export function publicSupabaseConfig(): PublicSupabaseConfig {
  if (!publicUrl || !publicAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy .env.local.example to .env.local and fill it in.',
    )
  }
  return { url: publicUrl, anonKey: publicAnonKey }
}

export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. Find it under Project Settings > API keys ' +
        'in the Supabase dashboard and add it to .env.local (server-side only).',
    )
  }
  return key
}

export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  // Set automatically on Vercel deployments.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
