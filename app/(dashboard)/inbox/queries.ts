/**
 * Shared between the server component's first load and the client's own
 * re-fetches, so the two cannot drift apart.
 *
 * This lives outside inbox-client.tsx on purpose. That file is `'use client'`,
 * and a value imported from a client module into a Server Component is replaced
 * by a client-reference proxy rather than the value itself — passing that to
 * .select() fails at runtime while still typechecking.
 */
export const CONV_SELECT =
  'id, status, last_message_at, channel, subject, contacts(id, email, anonymous_token)'
