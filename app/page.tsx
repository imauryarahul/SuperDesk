import { redirect } from 'next/navigation'

export default function HomePage() {
  // Middleware bounces anonymous visitors from /inbox to /login.
  redirect('/inbox')
}
