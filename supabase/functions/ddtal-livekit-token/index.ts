import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { AccessToken } from 'npm:livekit-server-sdk@2.19.2'

// JWT verification is performed with Auth.getUser (supports modern signing keys).
// Never accept user ID, room name or permissions from the request.
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || ''
  const allowed = (Deno.env.get('DDTAL_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)
  const cors = {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
  if (!allowed.includes(origin)) return reply({ error: 'Origem não autorizada.' }, 403)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405)
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return reply({ error: 'Faça login para entrar na sala.' }, 401)
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authError } = await client.auth.getUser(auth.slice(7))
  if (authError || !user) return reply({ error: 'Sessão inválida.' }, 401)
  let body: { channelId?: string }
  try { body = await req.json() } catch { return reply({ error: 'Pedido inválido.' }, 400) }
  if (typeof body.channelId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.channelId)) return reply({ error: 'Canal inválido.' }, 400)
  const { data: channel } = await client.from('ddtal_channels').select('id,kind,server_id').eq('id', body.channelId).single()
  if (!channel || !['voice', 'direct'].includes(channel.kind)) return reply({ error: 'Você não tem acesso a esta sala.' }, 403)
  const { data: profile } = await client.from('ddtal_profiles').select('display_name').eq('id', user.id).single()
  // Highest-position role becomes the badge shown next to the participant.
  const { data: memberRoles } = channel.server_id
    ? await client.from('ddtal_member_roles').select('role_id,ddtal_roles(name,color,position)').eq('server_id', channel.server_id).eq('user_id', user.id)
    : { data: [] }
  const topRole = (memberRoles || [])
    .map((row: { ddtal_roles?: { name: string; color: string; position: number } | { name: string; color: string; position: number }[] }) =>
      Array.isArray(row.ddtal_roles) ? row.ddtal_roles[0] : row.ddtal_roles)
    .filter(Boolean)
    .sort((a: { position: number }, b: { position: number }) => a.position - b.position)[0]
  const metadata = JSON.stringify({ role: topRole ? { name: topRole.name, color: topRole.color } : null })
  const key = Deno.env.get('DDTAL_LIVEKIT_API_KEY')
  const secret = Deno.env.get('DDTAL_LIVEKIT_API_SECRET')
  const url = Deno.env.get('DDTAL_LIVEKIT_URL')
  if (!key || !secret || !url) return reply({ error: 'As chamadas ainda não foram configuradas. O chat já está disponível.' }, 503)
  const token = new AccessToken(key, secret, {
    identity: user.id, name: profile?.display_name || 'Builder', ttl: '15m', metadata,
  })
  token.addGrant({
    room: `ddtal_${channel.id}`, roomJoin: true,
    canPublish: true, canSubscribe: true, canPublishData: true,
  })
  return reply({ token: await token.toJwt(), url })
})
