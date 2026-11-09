import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { AccessToken, RoomServiceClient } from 'npm:livekit-server-sdk@2.19.2'

// Voice moderation: server-mute, unmute ("give voice back"), kick and move
// participants between ddtal voice rooms. JWT is verified inside the function
// and permissions come from ddtal roles/RLS — never trust the request body.
// Supported actions: {action:'mute_mic'|'unmute_mic'|'kick'|'move', channelId,
// targetUserId, destinationChannelId?}
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
  if (!auth?.startsWith('Bearer ')) return reply({ error: 'Faça login para moderar a sala.' }, 401)
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authError } = await client.auth.getUser(auth.slice(7))
  if (authError || !user) return reply({ error: 'Sessão inválida.' }, 401)

  let body: { action?: string; channelId?: string; targetUserId?: string; destinationChannelId?: string }
  try { body = await req.json() } catch { return reply({ error: 'Pedido inválido.' }, 400) }
  const uuid = /^[0-9a-f-]{36}$/i
  if (!body.action || !uuid.test(body.channelId || '') || !uuid.test(body.targetUserId || ''))
    return reply({ error: 'Parâmetros inválidos.' }, 400)
  if (!['mute_mic', 'unmute_mic', 'kick', 'move'].includes(body.action)) return reply({ error: 'Ação inválida.' }, 400)
  if (body.action === 'move' && !uuid.test(body.destinationChannelId || '')) return reply({ error: 'Canal de destino inválido.' }, 400)

  const { data: channel } = await client.from('ddtal_channels').select('id,kind,server_id,name').eq('id', body.channelId).single()
  if (!channel || !['voice', 'direct'].includes(channel.kind)) return reply({ error: 'Você não tem acesso a esta sala.' }, 403)

  const { data: allowedToModerate } = await client.rpc('ddtal_can_moderate_voice', { p_channel: channel.id })
  if (allowedToModerate !== true) return reply({ error: 'Sem permissão para moderar esta sala.' }, 403)
  if (body.targetUserId === user.id && body.action !== 'mute_mic') return reply({ error: 'Você não pode aplicar isso em si mesmo.' }, 400)

  let destination: { id: string; server_id: string | null; name: string; kind: string } | null = null
  if (body.action === 'move') {
    const { data: dest } = await client.from('ddtal_channels').select('id,server_id,name,kind').eq('id', body.destinationChannelId).single()
    if (!dest || !['voice', 'direct'].includes(dest.kind)) return reply({ error: 'Canal de destino inválido.' }, 403)
    const { data: destPerm } = await client.rpc('ddtal_can_moderate_voice', { p_channel: dest.id })
    if (destPerm !== true) return reply({ error: 'Sem permissão no canal de destino.' }, 403)
    destination = dest
  }

  const key = Deno.env.get('DDTAL_LIVEKIT_API_KEY')
  const secret = Deno.env.get('DDTAL_LIVEKIT_API_SECRET')
  const url = Deno.env.get('DDTAL_LIVEKIT_URL')
  if (!key || !secret || !url) return reply({ error: 'Mídia não configurada.' }, 503)

  const httpUrl = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  const roomService = new RoomServiceClient(httpUrl, key, secret)
  const room = `ddtal_${channel.id}`

  try {
    if (body.action === 'mute_mic') {
      const participants = await roomService.listParticipants(room)
      const target = participants.find(p => p.identity === body.targetUserId)
      const mic = target?.tracks.find(t => t.source === 1 || t.type === 1) // MICROPHONE
      if (!mic) return reply({ error: 'O microfone desta pessoa não está ativo.' }, 404)
      await roomService.mutePublishedTrack(room, body.targetUserId, mic.sid, true)
      return reply({ ok: true, action: 'mute_mic' })
    }
    if (body.action === 'unmute_mic') {
      const participants = await roomService.listParticipants(room)
      const target = participants.find(p => p.identity === body.targetUserId)
      const mic = target?.tracks.find(t => t.source === 1 || t.type === 1)
      if (!mic) return reply({ error: 'Nenhum microfone para reativar.' }, 404)
      await roomService.mutePublishedTrack(room, body.targetUserId, mic.sid, false)
      return reply({ ok: true, action: 'unmute_mic' })
    }
    if (body.action === 'kick') {
      await roomService.removeParticipant(room, body.targetUserId)
      return reply({ ok: true, action: 'kick' })
    }
    // move: prefer server-side room switch; fall back to kick + realtime signal.
    const destinationRoom = `ddtal_${destination!.id}`
    try {
      await roomService.moveParticipant(room, body.targetUserId, destinationRoom)
      return reply({ ok: true, action: 'move', via: 'livekit', channelId: destination!.id, channelName: destination!.name })
    } catch {
      await roomService.removeParticipant(room, body.targetUserId)
      return reply({ ok: true, action: 'move', via: 'signal', channelId: destination!.id, channelName: destination!.name })
    }
  } catch (e) {
    const message = (e instanceof Error ? e.message : 'Falha ao falar com o servidor de voz.').toLowerCase()
    const absent = ['not found', 'could not find', 'does not exist', 'not found or empty', 'no participants'].some(s => message.includes(s))
    return reply({ error: absent ? 'Participante não está conectado à sala.' : 'Não foi possível concluir a ação.' }, absent ? 404 : 502)
  }
})
