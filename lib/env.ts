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

function required(name: string, hint: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}. ${hint}`)
  return value
}

export function postmarkServerToken(): string {
  return required(
    'POSTMARK_SERVER_TOKEN',
    'Find it under Servers > your server > API Tokens in Postmark.',
  )
}

/** Verified sender signature or a From address on a verified domain. */
export function postmarkFromEmail(): string {
  return required(
    'POSTMARK_FROM_EMAIL',
    'Must be a verified Sender Signature or an address on a verified domain in Postmark.',
  )
}

/**
 * The account-wide inbound address, e.g. abc123def@inbound.postmarkapp.com.
 * Per-workspace addresses are this with the workspace's inbound_token spliced
 * in as a plus-suffix — see inboundAddressFor() in lib/postmark.ts.
 */
export function postmarkInboundAddress(): string {
  const value = required(
    'POSTMARK_INBOUND_ADDRESS',
    'Copy the inbound address from Servers > your server > Inbound in Postmark.',
  )
  if (!value.includes('@')) {
    throw new Error(`POSTMARK_INBOUND_ADDRESS must be an email address, got "${value}".`)
  }
  return value
}

export type BasicCredentials = { user: string; pass: string }

/**
 * Credentials Postmark embeds in the inbound webhook URL as
 * https://user:pass@host/api/webhooks/postmark-inbound.
 */
export function postmarkInboundWebhookCredentials(): BasicCredentials {
  return {
    user: required(
      'POSTMARK_INBOUND_WEBHOOK_USER',
      'Choose any value and put it in the inbound webhook URL in Postmark.',
    ),
    pass: required(
      'POSTMARK_INBOUND_WEBHOOK_PASS',
      'Choose a long random value and put it in the inbound webhook URL in Postmark.',
    ),
  }
}

export function openaiApiKey(): string {
  return required(
    'OPENAI_API_KEY',
    'Create a key at https://platform.openai.com/api-keys and add it to .env.local.',
  )
}

export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  // Set automatically on Vercel deployments.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
