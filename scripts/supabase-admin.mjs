import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Credentials are read directly from a local dotenv file and never printed.
// Usage: node scripts/supabase-admin.mjs inspect|configure-local|migrate|test|deploy-function /absolute/path/to/.env.local
const [command, envPath] = process.argv.slice(2)
if (!envPath) throw new Error('Provide a local credential file path.')
const secrets = parseEnv(await readFile(resolve(envPath), 'utf8'))
const project = secrets.SUPABASE_PROJECT_REF || new URL(secrets.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
const token = secrets.SUPABASE_ACCESS_TOKEN
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is missing.')
async function api(path, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  })
  const text = await response.text()
  const result = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${result.message || 'unknown error'}`)
  return result
}
async function query(sql) { return api('/database/query', { method: 'POST', body: JSON.stringify({ query: sql }) }) }
if (command === 'inspect') {
  const config = await api('/config/auth')
  console.log(JSON.stringify({
    project,
    googleEnabled: config.external_google_enabled,
    emailEnabled: config.external_email_enabled,
    emailConfirmationRequired: config.mailer_autoconfirm === false,
    captchaEnabled: config.security_captcha_enabled,
    captchaProvider: config.security_captcha_provider,
    siteUrl: config.site_url,
    redirectAllowList: config.uri_allow_list,
  }, null, 2))
  console.log(JSON.stringify(await query("select tablename from pg_tables where schemaname='public' and tablename like 'ddtal_%'"), null, 2))
  console.log(JSON.stringify(await query("select policyname,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects'"), null, 2))
} else if (command === 'configure-local') {
  const url = secrets.NEXT_PUBLIC_SUPABASE_URL
  const key = secrets.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Public Supabase configuration is missing.')
  const siteKey = secrets.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''
  await writeFile('.env.local', `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\nVITE_TURNSTILE_SITE_KEY=${siteKey}\n`)
  console.log('Local public Supabase configuration generated. No private keys copied.')
} else if (command === 'allow-local-auth') {
  const config = await api('/config/auth')
  const entries = new Set((config.uri_allow_list || '').split(',').filter(Boolean))
  entries.add('http://localhost:5173/**')
  entries.add('http://127.0.0.1:5173/**')
  await api('/config/auth', { method: 'PATCH', body: JSON.stringify({ uri_allow_list: [...entries].join(',') }) })
  await api('/secrets', { method: 'POST', body: JSON.stringify([
    { name: 'DDTAL_ALLOWED_ORIGINS', value: 'http://localhost:5173,http://127.0.0.1:5173' },
  ]) })
  console.log('Local Discodigital redirects appended; existing authentication settings preserved. Local Edge Function origins configured.')
} else if (command === 'verify-migration') {
  const migration = (await readFile('supabase/migrations/202611090001_ddtal_core.sql', 'utf8')).replace(/commit;\s*$/, '')
  const tests = (await readFile('tests/permissions.sql', 'utf8')).replace('begin;', '')
  const result = await query(migration + '\n' + tests)
  console.log(JSON.stringify(result.filter(row => row.result), null, 2))
  console.log('Migration and RLS verified in a rolled-back transaction.')
} else if (command === 'migrate') {
  const existing = await query("select tablename from pg_tables where schemaname='public' and tablename='ddtal_profiles'")
  if (existing.length) throw new Error('ddtal tables already exist. Refusing to reapply the baseline.')
  await query(await readFile('supabase/migrations/202611090001_ddtal_core.sql', 'utf8'))
  console.log('Discodigital baseline applied.')
} else if (command === 'test') {
  const result = await query(await readFile('tests/permissions.sql', 'utf8'))
  console.log(JSON.stringify(result.filter(row => row.result), null, 2))
  console.log('Permissions integration checks completed; fixtures rolled back.')
} else if (command === 'deploy-function') {
  const cli = resolve(process.env.APPDATA, 'npm/node_modules/supabase/dist/supabase.js')
  const result = spawnSync(process.execPath, [cli, 'functions', 'deploy', 'ddtal-livekit-token', '--project-ref', project, '--use-api', '--yes'], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, stdio: 'inherit',
  })
  process.exitCode = result.status || 0
} else {
  throw new Error('Unknown operation.')
}
