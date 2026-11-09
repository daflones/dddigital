import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'

const env = parseEnv(await readFile('.env.local', 'utf8'))
const names = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_TURNSTILE_SITE_KEY']
const result = spawnSync('docker', ['build', '-t', 'ddtal-web:local', ...names.flatMap(name => ['--build-arg', name]), '.'], {
  env: { ...process.env, ...Object.fromEntries(names.map(name => [name, env[name] || ''])) },
  stdio: 'inherit',
})
process.exitCode = result.status || 0
