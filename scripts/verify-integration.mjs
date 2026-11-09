import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { createHmac, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect } from '@playwright/test'

// Runs against the configured Supabase, using disposable users; no email is sent.
// All records, uploaded files, and accounts are cleaned up in finally.
const path = process.argv[2]
if (!path) throw new Error('Provide the path to a local administrative dotenv file.')
const env = parseEnv(await readFile(path, 'utf8'))
const url = env.NEXT_PUBLIC_SUPABASE_URL
const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const suffix = randomUUID().slice(0, 8)
const testMedia = process.argv.includes('--media')
const password = randomUUID() + 'aA1!'
const users = []
const serverIds = []
const directIds = []
const uploads = []
let browser
function check(result) { if (result.error) throw new Error(result.error.message, { cause: result.error }); return result.data }
async function login(page, user, path = '/') {
  // Supabase's administrative magic-link API issues authentic sessions for test
  // users without sending email or disabling the project's production CAPTCHA.
  const session = check(await user.client.auth.getSession()).session
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: JSON.stringify(session) })
  await page.goto('http://localhost:5173' + path)
}
try {
  for (const name of ['Teacher', 'Student']) {
    const email = `ddtal-e2e-${name.toLowerCase()}-${suffix}@example.invalid`
    const result = check(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Test ${name}` } }))
    const client = createClient(url, publicKey, { auth: { persistSession: false } })
    const user = { id: result.user.id, email, client, profile: null }
    users.push(user)
    const link = check(await admin.auth.admin.generateLink({ type: 'magiclink', email }))
    check(await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }))
    const profile = check(await client.rpc('ddtal_ensure_profile'))
    user.profile = profile
  }
  const [teacher, student] = users
  browser = await chromium.launch({ args: testMedia ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : [] })
  const first = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const second = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  if (testMedia) {
    for (const context of [first, second]) {
      await context.grantPermissions(['microphone', 'camera'], { origin: 'http://localhost:5173' })
      // Synthetic screen source tests the real SFU, decoding, annotation and UI
      // pipeline. The native desktop picker and real network quality are manual.
      await context.addInitScript(() => {
        navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: true })
      })
    }
  }
  const a = await first.newPage()
  const b = await second.newPage()
  const errors = []
  a.on('pageerror', e => errors.push(e.message)); b.on('pageerror', e => errors.push(e.message))
  await login(a, teacher)
  await a.getByRole('button', { name: 'Criar meu primeiro servidor', exact: true }).click()
  await a.getByLabel('Nome do servidor').fill(`DDTAL test ${suffix}`)
  await a.getByLabel('Uma breve descrição').fill('Temporary end-to-end verification')
  await a.getByRole('button', { name: 'Criar meu servidor', exact: true }).click()
  await expect(a.getByRole('button', { name: `DDTAL test ${suffix}`, exact: true })).toBeVisible({ timeout: 15000 })
  const server = check(await teacher.client.from('ddtal_servers').select('*').eq('name', `DDTAL test ${suffix}`).single())
  serverIds.push(server.id)
  const voice = check(await teacher.client.from('ddtal_channels').select('*').eq('server_id', server.id).eq('name', 'Sala de aula').single())
  await a.getByRole('button', { name: 'Convide sua comunidade', exact: false }).click()
  await a.getByRole('button', { name: 'Gerar link de convite' }).click()
  const invite = new URL(await a.getByLabel('Seu link de convite').inputValue())
  await a.getByRole('button', { name: 'Fechar', exact: true }).click()
  await login(b, student, invite.pathname + invite.search)
  await expect(b.getByRole('button', { name: `DDTAL test ${suffix}`, exact: true })).toBeVisible({ timeout: 15000 })
  console.log('PASS: real Auth sessions, server creation and invite onboarding (password CAPTCHA flow is manual).')

  const message = `Realtime classroom message ${suffix}`
  await a.getByRole('textbox', { name: 'Mensagem', exact: true }).fill(message)
  await a.getByRole('button', { name: 'Enviar mensagem', exact: true }).click()
  await expect(b.getByText(message, { exact: true })).toBeVisible({ timeout: 15000 })
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64')
  await a.locator('input[type=file]').setInputFiles({ name: 'original-image.png', mimeType: 'image/png', buffer: bytes })
  await a.getByRole('button', { name: 'Enviar mensagem', exact: true }).click()
  await expect(b.getByRole('img', { name: 'original-image.png' })).toBeVisible({ timeout: 15000 })
  const attachment = check(await teacher.client.from('ddtal_messages').select('*').eq('channel_id', voice.id).eq('attachment_name', 'original-image.png').single())
  uploads.push(attachment.attachment_path)
  const downloaded = check(await student.client.storage.from('ddtal-attachments').download(attachment.attachment_path))
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes)
  const anon = createClient(url, publicKey, { auth: { persistSession: false } })
  const anonymousFile = await anon.storage.from('ddtal-attachments').download(attachment.attachment_path)
  assert.ok(anonymousFile.error, 'Anonymous users must not download private files')
  console.log('PASS: two-browser realtime messages, private image upload, original bytes preserved.')

  await a.getByRole('button', { name: 'Notas', exact: true }).click()
  await b.getByRole('button', { name: 'Notas', exact: true }).click()
  await expect(b.getByRole('button', { name: 'Editar anotações' })).toHaveCount(0)
  await a.getByRole('button', { name: 'Editar anotações' }).click()
  await a.getByRole('textbox', { name: 'Anotações compartilhadas' }).fill('# Aula de integração\n\nNotas publicadas pelo professor.')
  await a.getByRole('button', { name: 'Salvar para a turma' }).click()
  await expect(b.getByRole('heading', { name: 'Aula de integração' })).toBeVisible({ timeout: 15000 })
  console.log('PASS: instructor notes synchronize live; student has read-only access.')

  await a.getByRole('button', { name: 'Amigos', exact: true }).first().click()
  await a.getByRole('textbox', { name: 'Identificador do amigo' }).fill(student.profile.handle)
  await a.getByRole('button', { name: 'Adicionar amigo' }).click()
  await expect(a.getByText('Solicitação enviada.', { exact: true })).toBeVisible()
  await b.getByRole('button', { name: 'Amigos', exact: true }).first().click()
  await b.getByRole('button', { name: 'Solicitações', exact: false }).click()
  await b.getByRole('button', { name: 'Aceitar Test Teacher', exact: true }).click()
  await b.getByRole('button', { name: /^Amigos \d/ }).click()
  await b.getByRole('button', { name: 'Conversar com Test Teacher', exact: true }).click()
  const direct = check(await student.client.rpc('ddtal_open_dm', { p_peer: teacher.id }))
  directIds.push(direct)
  await expect(b.getByRole('button', { name: 'Entrar na sala', exact: true })).toBeVisible()
  await b.getByRole('button', { name: 'Chat', exact: true }).click()
  await b.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Conversa direta verificada.')
  await b.getByRole('button', { name: 'Enviar mensagem', exact: true }).click()
  await expect(b.locator('.messages').getByText('Conversa direta verificada.', { exact: true })).toBeVisible({ timeout: 15000 })
  const dmMessage = check(await teacher.client.from('ddtal_messages').select('content').eq('channel_id', direct).single())
  assert.equal(dmMessage.content, 'Conversa direta verificada.')
  console.log('PASS: friend request, acceptance and private direct conversation.')

  const auth = check(await teacher.client.auth.getSession()).session.access_token
  const endpoint = url + '/functions/v1/ddtal-livekit-token'
  const request = (body, token = auth, origin = 'http://localhost:5173') => fetch(endpoint, {
    method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, apikey: publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal((await request({ channelId: voice.id }, 'invalid')).status, 401)
  assert.equal((await request({ channelId: randomUUID() })).status, 403)
  assert.equal((await request({ channelId: voice.id }, auth, 'https://untrusted.example')).status, 403)
  const response = await request({ channelId: voice.id })
  assert.ok([200, 503].includes(response.status), 'Authorized call should receive credentials or an explicit setup message')
  if (response.status === 503) assert.match((await response.json()).error, /ainda não foram configuradas/)
  console.log(`PASS: Edge Function JWT, origin and room authorization; media configuration status ${response.status}.`)
  if (testMedia) {
    function localToken(user, channelId) {
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
      const head = encode({ alg: 'HS256', typ: 'JWT' })
      const payload = encode({
        iss: 'devkey', sub: user.id, name: user.profile.display_name,
        nbf: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 600,
        video: { roomJoin: true, room: `ddtal_${channelId}`, canPublish: true, canSubscribe: true, canPublishData: true },
      })
      return `${head}.${payload}.${createHmac('sha256', 'secret').update(`${head}.${payload}`).digest('base64url')}`
    }
    for (const [page, user] of [[a, teacher], [b, student]]) {
      await page.route('**/functions/v1/ddtal-livekit-token', async route => {
        const { channelId } = route.request().postDataJSON()
        await route.fulfill({ json: { token: localToken(user, channelId), url: 'ws://localhost:7880' } })
      })
      await page.getByRole('button', { name: `DDTAL test ${suffix}`, exact: true }).click()
      await page.getByRole('button', { name: 'Sala de aula', exact: true }).click()
      await page.getByRole('button', { name: 'Entrar na sala', exact: true }).click()
      await expect(page.getByText('Você está na sala', { exact: true })).toBeVisible({ timeout: 20000 })
    }
    await expect(a.getByText('2 pessoas · áudio ao vivo', { exact: true })).toBeVisible({ timeout: 15000 })
    await a.getByRole('button', { name: 'Ativar microfone', exact: true }).click()
    await expect(a.getByRole('button', { name: 'Desativar microfone', exact: true })).toBeVisible({ timeout: 10000 })
    await a.getByRole('button', { name: 'Ativar câmera', exact: true }).click()
    await expect(b.locator('.participant-tile video')).toBeVisible({ timeout: 15000 })
    await expect.poll(() => b.locator('.participant-tile video').evaluate(video => video.videoWidth > 0 && video.currentTime > 0), { timeout: 15000 }).toBe(true)
    await a.getByRole('button', { name: 'Compartilhar minha tela', exact: true }).click()
    await expect(b.locator('.screen-fit video')).toBeVisible({ timeout: 15000 })
    await expect.poll(() => b.locator('.screen-fit video').evaluate(video => video.videoWidth > 0 && video.currentTime > 0), { timeout: 15000 }).toBe(true)
    await a.getByRole('button', { name: 'Desenhar sobre a tela', exact: true }).click()
    const surface = await a.getByLabel('Anotações sobre a tela').boundingBox()
    await a.mouse.move(surface.x + surface.width * .3, surface.y + surface.height * .3)
    await a.mouse.down()
    await a.mouse.move(surface.x + surface.width * .6, surface.y + surface.height * .6, { steps: 12 })
    await a.mouse.up()
    await expect(b.locator('.annotation-layer polyline')).toHaveCount(1)
    await a.getByRole('button', { name: 'Apagar minhas marcações', exact: true }).click()
    await expect(b.locator('.annotation-layer polyline')).toHaveCount(0)
    await a.getByRole('button', { name: 'Ponteiro ao vivo', exact: true }).click()
    await a.mouse.move(surface.x + surface.width * .5, surface.y + surface.height * .4)
    await expect(b.locator('.live-laser')).toBeVisible()
    await a.getByRole('button', { name: 'Levantar mão', exact: true }).click()
    await expect(b.locator('.participant-tile .raised')).toHaveCount(1)
    await a.getByRole('button', { name: 'Sair da sala', exact: true }).click()
    await expect(a.getByRole('button', { name: 'Entrar na sala', exact: true })).toBeVisible({ timeout: 15000 })
    await expect(b.getByText('1 pessoa · áudio ao vivo', { exact: true })).toBeVisible({ timeout: 15000 })
    console.log('PASS: local LiveKit SFU, two participants, microphone, decoded camera/synthetic screen, live drawing, pointer, raised hand and leave.')
  }
  assert.deepEqual(errors, [])
  console.log('Integration verification completed.')
} finally {
  await browser?.close()
  const cleanupErrors = []
  async function cleanup(result) { if (result.error) cleanupErrors.push(result.error.message) }
  for (const user of users) {
    const memberships = await admin.from('ddtal_channel_members').select('channel_id').eq('user_id', user.id)
    for (const row of memberships.data || []) if (!directIds.includes(row.channel_id)) directIds.push(row.channel_id)
    const messages = await admin.from('ddtal_messages').select('attachment_path').eq('author_id', user.id).not('attachment_path', 'is', null)
    for (const row of messages.data || []) if (!uploads.includes(row.attachment_path)) uploads.push(row.attachment_path)
  }
  if (uploads.length) await cleanup(await admin.storage.from('ddtal-attachments').remove(uploads))
  if (directIds.length) await cleanup(await admin.from('ddtal_channels').delete().in('id', directIds))
  // Also finds servers if a browser assertion failed immediately after creation.
  for (const user of users) {
    const owned = await admin.from('ddtal_servers').select('id').eq('owner_id', user.id)
    for (const server of owned.data || []) if (!serverIds.includes(server.id)) serverIds.push(server.id)
  }
  if (serverIds.length) await cleanup(await admin.from('ddtal_servers').delete().in('id', serverIds))
  for (const user of users) {
    await user.client.auth.signOut()
    await cleanup(await admin.auth.admin.deleteUser(user.id))
  }
  if (cleanupErrors.length) throw new Error('Fixture cleanup incomplete: ' + cleanupErrors.join('; '))
  console.log('Temporary users, communities, conversations and uploads removed.')
}
