// @ts-check
import { readFileSync } from 'fs'
import { build, context } from 'esbuild'

// Load .env.local so NEXT_PUBLIC_* vars are available.
// In CI / Vercel the vars come from the environment directly.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].trim()
  }
} catch { /* ignore missing file */ }

const isWatch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const cfg = {
  entryPoints: ['widget/src/index.ts'],
  bundle: true,
  minify: !isWatch,
  outfile: 'public/widget.js',
  platform: 'browser',
  target: 'es2017',
  define: {
    'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    ),
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    ),
  },
}

if (isWatch) {
  const ctx = await context(cfg)
  await ctx.watch()
  console.log('[widget] watching for changes → public/widget.js')
} else {
  await build(cfg)
  console.log('[widget] built → public/widget.js')
}
