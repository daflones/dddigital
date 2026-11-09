import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, AudioLines, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Compass, Hash, Headphones, LogOut, Menu, MessageCircle, MessageSquare, Phone, PhoneOff, Plus, Radio, Search, Settings2, ShieldCheck, Sparkles, Users, UserPlus, Volume2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Auth } from './components/Auth'
import { Avatar, Brand, Modal, StyledName } from './components/ui'
import { Chat } from './components/Chat'
import { Notes } from './components/Notes'
import { ClassroomLobby } from './components/Classroom'
import { Friends } from './components/Friends'
import { CreateChannel, CreateServer, Invite, ManageRoles, ProfileSettings, SearchMessages, ServerSettings } from './components/Dialogs'
import { MembersPanel } from './components/Members'
import { db, errorMessage, rpc, serverIconUrl, supabase } from './lib/supabase'
import { pop, startRingtone } from './lib/sounds'
import { demoChannels, demoMembers, demoProfile, demoServer } from './lib/demo'
import type { Channel, Membership, MemberRole, Presence, Profile, Role, RoleFlag, RoomCredentials, Server } from './lib/types'

const LiveRoom = lazy(() => import('./components/LiveRoom'))
type DialogName = 'server' | 'channel' | 'invite' | 'profile' | 'search' | 'help' | 'roles' | 'serverSettings' | null

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [demo, setDemo] = useState(new URLSearchParams(location.search).get('demo') === '1')
  const [ready, setReady] = useState(!supabase)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [initialError, setInitialError] = useState('')
  const [recovery, setRecovery] = useState(new URLSearchParams(location.search).get('recovery') === '1')
  const [profileRetry, setProfileRetry] = useState(0)
  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active) { setSession(data.session); setReady(true); if (error) toast.error(error.message) }
    })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (active) { setSession(next); setReady(true); if (event === 'PASSWORD_RECOVERY') setRecovery(true) }
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (!session) { setProfile(null); return }
    let active = true
    setInitialError('')
    rpc<Profile>('ddtal_ensure_profile').then(p => { if (active) setProfile(p) }).catch(e => { if (active) setInitialError(errorMessage(e)) })
    return () => { active = false }
  }, [session?.user.id, profileRetry])
  function exitDemo() {
    setDemo(false)
    const url = new URL(location.href); url.searchParams.delete('demo'); history.replaceState(null, '', url)
  }
  if (!ready || (session && !profile && !initialError)) return <div className="boot"><Brand /><span>Preparando seu espaço…</span></div>
  if (initialError && session) return <div className="boot"><Brand /><p role="alert">{initialError}</p><button className="primary" onClick={() => setProfileRetry(n => n + 1)}>Tentar novamente</button><button className="secondary" onClick={() => void db().auth.signOut()}>Sair</button></div>
  if (recovery && session) return <Recovery done={() => { setRecovery(false); history.replaceState(null, '', location.pathname) }} />
  if (!session && !demo) return <Auth onDemo={() => setDemo(true)} />
  return <Workspace key={session?.user.id || 'demo'} profile={profile || demoProfile} updateProfile={setProfile} demo={!session} exitDemo={exitDemo} />
}

function Recovery({ done }: { done: () => void }) {
  const [busy, setBusy] = useState(false)
  return <div className="boot"><Brand /><form className="recovery-form" onSubmit={async e => {
    e.preventDefault(); const password = String(new FormData(e.currentTarget).get('password')); setBusy(true)
    const { error } = await db().auth.updateUser({ password })
    if (error) toast.error(error.message)
    else { toast.success('Senha atualizada.'); done() }
    setBusy(false)
  }}><h2>Seu novo começo.</h2><label>Nova senha<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label><button className="primary full" disabled={busy}>Atualizar senha</button></form></div>
}

function Workspace({ profile, updateProfile, demo, exitDemo }: { profile: Profile; updateProfile: (p: Profile) => void; demo: boolean; exitDemo: () => void }) {
  const [servers, setServers] = useState<Server[]>(demo ? [demoServer] : [])
  const [serverId, setServerId] = useState<string | null>(demo ? demoServer.id : null)
  const [channels, setChannels] = useState<Channel[]>(demo ? demoChannels : [])
  const [channelId, setChannelId] = useState<string | null>(demo ? 'demo-class' : null)
  const [members, setMembers] = useState<Membership[]>(demo ? demoMembers : [])
  const [roles, setRoles] = useState<Role[]>([])
  const [memberRoles, setMemberRoles] = useState<MemberRole[]>([])
  const [view, setView] = useState<'server' | 'friends' | 'dm'>('server')
  const [panel, setPanel] = useState<'chat' | 'notes' | 'members'>('chat')
  const [dialog, setDialog] = useState<DialogName>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [mobilePanel, setMobilePanel] = useState(false)
  const [loading, setLoading] = useState(!demo)
  const [loadError, setLoadError] = useState('')
  const [joining, setJoining] = useState(false)
  const [room, setRoom] = useState<RoomCredentials | null>(null)
  const [roomParticipants, setRoomParticipants] = useState<string[]>([])
  const [inviteError, setInviteError] = useState('')
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [dmPeers, setDmPeers] = useState<Record<string, Profile>>({})
  const [incomingCall, setIncomingCall] = useState<{ channelId: string; from: string; name: string; avatar?: string | null } | null>(null)
  const [calling, setCalling] = useState<{ channelId: string; name: string; avatar?: string | null } | null>(null)
  const [statusMenu, setStatusMenu] = useState(false)
  const inviteAttempted = useRef(false)
  const roomRef = useRef<RoomCredentials | null>(null)
  roomRef.current = room
  const myStatus = profile.presence || 'online'
  // OS-level notifications (visible even when the window is minimized).
  const notify = useCallback((title: string, body: string, onclick?: () => void) => {
    try {
      if (!('Notification' in window)) return
      if (Notification.permission !== 'granted') return
      const n = new Notification(title, { body, icon: '/favicon.svg' })
      n.onclick = () => { window.focus(); onclick?.() }
    } catch { /* notifications unavailable */ }
  }, [])
  // Ask for notification permission on the first user interaction.
  useEffect(() => {
    if (demo || !('Notification' in window) || Notification.permission !== 'default') return
    const ask = () => { void Notification.requestPermission() }
    document.addEventListener('click', ask, { once: true })
    return () => document.removeEventListener('click', ask)
  }, [demo])
  const currentServer = servers.find(s => s.id === serverId)
  const channel = channels.find(c => c.id === channelId)
  const staff = currentServer?.owner_id === profile.id || members.some(m => m.user_id === profile.id && m.role === 'moderator')
  const myRoles = memberRoles.filter(mr => mr.user_id === profile.id).map(mr => roles.find(r => r.id === mr.role_id)).filter((r): r is Role => Boolean(r))
  const can = useCallback((flag: RoleFlag) => staff || myRoles.some(r => r[flag]), [staff, myRoles])
  const voice = channel?.kind === 'voice' || channel?.kind === 'direct'
  const activeRoomVisible = view !== 'friends' && room?.channel.id === channel?.id

  const load = useCallback(async (preferred?: string) => {
    if (demo) return
    setLoading(true); setLoadError('')
    try {
      const [s, c, peers] = await Promise.all([
        db().from('ddtal_servers').select('*').order('created_at'),
        db().from('ddtal_channels').select('*').order('created_at'),
        db().from('ddtal_channel_members').select('channel_id,profile:ddtal_profiles!user_id(*)').neq('user_id', profile.id),
      ])
      if (s.error) throw s.error
      if (c.error) throw c.error
      if (peers.error) throw peers.error
      const peerMap = new Map((peers.data as unknown as { channel_id: string; profile: Profile }[]).map(m => [m.channel_id, m.profile]))
      const names = new Map([...peerMap].map(([id, p]) => [id, p.display_name]))
      setDmPeers(Object.fromEntries(peerMap))
      setServers(s.data as Server[])
      setChannels((c.data as Channel[]).map(ch => ch.kind === 'direct' ? { ...ch, name: names.get(ch.id) || 'Conversa direta' } : ch))
      setServerId(previous => preferred || (s.data.some(sv => sv.id === previous) ? previous : s.data[0]?.id || null))
    } catch (e) { setLoadError(errorMessage(e)) }
    finally { setLoading(false) }
  }, [demo, profile.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (demo || inviteAttempted.current) return
    const invitation = new URLSearchParams(location.search).get('invite')
    if (!invitation) return
    inviteAttempted.current = true
    rpc<string>('ddtal_join_invite', { p_invite: invitation }).then(id => {
      const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState(null, '', url)
      toast.success('Você está dentro. Boas conexões!'); void load(id)
    }).catch(e => setInviteError(errorMessage(e)))
  }, [demo, load])
  useEffect(() => {
    if (demo || !serverId) { if (!serverId) { setMembers([]); setRoles([]); setMemberRoles([]) } return }
    let active = true
    setMembers([])
    async function refresh() {
      const [m, r, mr] = await Promise.all([
        db().from('ddtal_members').select('user_id,role,nickname,profile:ddtal_profiles!user_id(*)').eq('server_id', serverId!),
        db().from('ddtal_roles').select('*').eq('server_id', serverId!).order('position'),
        db().from('ddtal_member_roles').select('user_id,role_id').eq('server_id', serverId!),
      ])
      if (!active) return
      if (m.error) toast.error(m.error.message)
      else setMembers(m.data as unknown as Membership[])
      if (!r.error) setRoles(r.data as Role[])
      if (!mr.error) setMemberRoles(mr.data as MemberRole[])
    }
    void refresh()
    const sub = db().channel(`ddtal-server-${serverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ddtal_members', filter: `server_id=eq.${serverId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ddtal_roles', filter: `server_id=eq.${serverId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ddtal_member_roles', filter: `server_id=eq.${serverId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ddtal_channels', filter: `server_id=eq.${serverId}` }, () => void load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ddtal_servers', filter: `id=eq.${serverId}` }, () => void load())
      .subscribe(status => { if (status === 'SUBSCRIBED') { void refresh(); void load() } })
    return () => { active = false; void db().removeChannel(sub) }
  }, [serverId, demo, load])
  useEffect(() => {
    setChannelId(previous => {
      const keep = channels.find(c => c.id === previous)
      if (keep && (keep.server_id === serverId || (keep.kind === 'direct' && view !== 'server'))) return previous
      return channels.find(c => c.server_id === serverId && c.kind === 'voice')?.id || channels.find(c => c.server_id === serverId)?.id || null
    })
  }, [channels, serverId, view])
  const leave = useCallback(() => setRoom(null), [])
  function requireAccount(fn: () => void) { if (demo) { toast.info('Entre na sua conta para conectar sua comunidade.'); exitDemo() } else fn() }
  function selectChannel(id: string, kind?: Channel['kind']) {
    setChannelId(id)
    const target = kind ? { kind } : channels.find(c => c.id === id)
    setView(target?.kind === 'direct' ? 'dm' : 'server')
    setMobileNav(false)
  }
  function selectServer(id: string) { setServerId(id); setChannelId(null); setView('server') }
  async function joinById(channelId: string) {
    let target = channels.find(c => c.id === channelId)
    if (!target) {
      const { data } = await db().from('ddtal_channels').select('*').eq('id', channelId).single()
      if (data) { target = data as Channel; setChannels(current => [...current.filter(c => c.id !== channelId), target!]) }
    }
    if (!target) return
    selectChannel(target.id, target.kind)
    await join(target)
  }
  const refreshRoles = useCallback(async () => {
    if (demo || !serverId) return
    const [r, mr] = await Promise.all([
      db().from('ddtal_roles').select('*').eq('server_id', serverId).order('position'),
      db().from('ddtal_member_roles').select('user_id,role_id').eq('server_id', serverId),
    ])
    if (!r.error) setRoles(r.data as Role[])
    if (!mr.error) setMemberRoles(mr.data as MemberRole[])
  }, [demo, serverId])
  // Voice moderation: forwards to the edge function; on a "move" fallback also
  // signals the target's client so it rejoins the destination channel.
  async function moderate(action: 'mute_mic' | 'unmute_mic' | 'kick' | 'move', channelId: string, targetUserId: string, destinationChannelId?: string) {
    const { data, error } = await db().functions.invoke('ddtal-moderate-voice', { body: { action, channelId, targetUserId, destinationChannelId } })
    if (error) {
      let detail = error.message
      try { detail = (await error.context?.json())?.error || detail } catch { /* keep message */ }
      throw new Error(detail)
    }
    if (data?.error) throw new Error(data.error)
    if (action === 'move' && data?.channelId) void sendSignal(targetUserId, { type: 'move', channelId: data.channelId, channelName: data.channelName })
    return data
  }
  async function sendSignal(userId: string, payload: object) {
    const signal = db().channel(`ddtal-signal-${userId}`)
    signal.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        void signal.send({ type: 'broadcast', event: 'signal', payload }).finally(() => void db().removeChannel(signal))
      }
    })
  }
  // Effective presence: declared status + actually connected (tracked).
  const presenceOf = useCallback((p?: Profile | null): Presence => {
    if (!p) return 'offline'
    const declared = p.presence || 'online'
    if (declared === 'offline') return 'offline'
    return onlineIds.has(p.id) ? declared : 'offline'
  }, [onlineIds])
  // Who is currently connected — realtime presence channel.
  useEffect(() => {
    if (demo) return
    const presence = db().channel('ddtal-presence', { config: { presence: { key: profile.id } } })
    presence.on('presence', { event: 'sync' }, () => setOnlineIds(new Set(Object.keys(presence.presenceState()))))
      .subscribe(status => { if (status === 'SUBSCRIBED') void presence.track({ status: myStatus }) })
    return () => { void db().removeChannel(presence) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, profile.id])
  // Listen for moderator signals and incoming/declined calls.
  useEffect(() => {
    if (demo) return
    const signal = db().channel(`ddtal-signal-${profile.id}`)
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        if (payload.type === 'move') {
          toast.info(`Você foi movido para ${payload.channelName || 'outra sala'}.`)
          void joinById(String(payload.channelId))
        } else if (payload.type === 'call') {
          if (myStatus !== 'online') {
            void sendSignal(String(payload.from), { type: 'call_declined', channelId: payload.channelId, name: profile.display_name, reason: myStatus })
            return
          }
          setIncomingCall({ channelId: String(payload.channelId), from: String(payload.from), name: String(payload.name || 'Alguém'), avatar: payload.avatar as string | null })
          notify(`${payload.name || 'Alguém'} está te ligando`, 'Clique para ver a chamada.')
        } else if (payload.type === 'call_declined') {
          const reason = payload.reason === 'busy' ? 'está ocupado(a) agora'
            : payload.reason === 'away' ? 'está ausente'
            : payload.reason === 'timeout' ? 'não atendeu a ligação'
            : payload.reason === 'offline' ? 'está offline' : 'recusou a ligação'
          toast.info(`${payload.name || 'A pessoa'} ${reason}.`)
          setCalling(null)
          if (roomRef.current?.channel.id === payload.channelId) leave()
        }
      }).subscribe()
    return () => { void db().removeChannel(signal) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, profile.id, myStatus, notify])
  // Outgoing call: ringback tone until answered, declined or ~45s.
  useEffect(() => {
    if (!calling) return
    const stop = startRingtone()
    const timer = setTimeout(() => {
      setCalling(null)
      if (roomRef.current?.channel.id === calling.channelId) leave()
      toast.info('Chamada não atendida.')
    }, 45000)
    return () => { stop(); clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calling])
  // Callee joined the room -> stop showing the calling placeholder.
  useEffect(() => {
    if (calling && roomParticipants.length > 1) setCalling(null)
  }, [calling, roomParticipants])
  useEffect(() => { if (!room) setCalling(null) }, [room])
  // Incoming call ring + auto-decline after ~32s.
  useEffect(() => {
    if (!incomingCall) return
    const stop = startRingtone()
    const timer = setTimeout(() => {
      void sendSignal(incomingCall.from, { type: 'call_declined', channelId: incomingCall.channelId, name: profile.display_name, reason: 'timeout' })
      setIncomingCall(null)
    }, 32000)
    return () => { stop(); clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall])
  // DM notification sound + toast for messages arriving outside the open chat.
  useEffect(() => {
    if (demo) return
    const dmIds = new Set(channels.filter(c => c.kind === 'direct').map(c => c.id))
    if (!dmIds.size) return
    const sub = db().channel('ddtal-dm-notify')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ddtal_messages' }, payload => {
        const m = payload.new as { author_id: string; channel_id: string }
        if (m.author_id === profile.id || !dmIds.has(m.channel_id)) return
        if (myStatus !== 'online') return
        if (m.channel_id === channelId && view === 'dm' && document.visibilityState === 'visible') return
        const peer = dmPeers[m.channel_id]
        if (document.visibilityState === 'hidden') {
          notify(`Nova mensagem de ${peer?.display_name || 'conversa privada'}`, 'Clique para abrir a conversa.', () => selectChannel(m.channel_id, 'direct'))
          pop()
        } else {
          pop()
          toast(`Nova mensagem de ${peer?.display_name || 'conversa privada'}`, {
            action: { label: 'Abrir', onClick: () => selectChannel(m.channel_id, 'direct') },
          })
        }
      }).subscribe()
    return () => { void db().removeChannel(sub) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, channels, myStatus, channelId, view, dmPeers, profile.id])
  async function join(target = channel) {
    if (!target) return
    if (demo) return requireAccount(() => {})
    setJoining(true)
    try {
      const { data, error } = await db().functions.invoke('ddtal-livekit-token', { body: { channelId: target.id } })
      if (error) {
        let detail = 'Não foi possível conectar a chamada.'
        try { detail = (await error.context?.json())?.error || error.message } catch { detail = error.message }
        throw new Error(detail)
      }
      if (!data?.token || !data?.url) throw new Error(data?.error || 'A sala ainda não está configurada.')
      setRoom({ token: data.token, url: data.url, channel: target }); setView('server')
    } catch (e) { toast.error(errorMessage(e), { duration: 6500 }) }
    finally { setJoining(false) }
  }
  async function openDM(peer: Profile, call = false) {
    try {
      const id = await rpc<string>('ddtal_open_dm', { p_peer: peer.id })
      const { data, error } = await db().from('ddtal_channels').select('*').eq('id', id).single()
      if (error) throw error
      const dm: Channel = { ...data, name: peer.display_name }
      setChannels(current => [...current.filter(c => c.id !== id), dm])
      setDmPeers(current => ({ ...current, [id]: peer }))
      selectChannel(id, 'direct')
      if (call) {
        await join(dm)
        setCalling({ channelId: id, name: peer.display_name, avatar: peer.avatar_url })
        void sendSignal(peer.id, { type: 'call', channelId: id, from: profile.id, name: profile.display_name, avatar: profile.avatar_url })
      }
    } catch (e) { toast.error(errorMessage(e)) }
  }
  function acceptCall() {
    if (!incomingCall) return
    const target = incomingCall.channelId
    setIncomingCall(null)
    void joinById(target)
  }
  function declineCall(reason = 'declined') {
    if (!incomingCall) return
    void sendSignal(incomingCall.from, { type: 'call_declined', channelId: incomingCall.channelId, name: profile.display_name, reason })
    setIncomingCall(null)
  }
  const statusOptions: { v: Presence; label: string; hint: string }[] = [
    { v: 'online', label: 'Disponível', hint: 'Recebe ligações e notificações' },
    { v: 'busy', label: 'Ocupado', hint: 'Sem toque nem notificações' },
    { v: 'away', label: 'Ausente', hint: 'Sem toque nem notificações' },
    { v: 'offline', label: 'Invisível', hint: 'Aparece offline para todos' },
  ]
  async function setPresence(v: Presence) {
    setStatusMenu(false)
    updateProfile({ ...profile, presence: v })
    if (demo) return
    const { error } = await db().from('ddtal_profiles').update({ presence: v }).eq('id', profile.id)
    if (error) toast.error(error.message)
  }
  async function signOut() {
    if (demo) return exitDemo()
    const { error } = await db().auth.signOut()
    if (error) toast.error(error.message)
  }

  return <div className="app-shell">
    <aside className="server-rail"><button className="home-button" title="Início — suas conversas" aria-label="Início" onClick={() => { setView('friends'); setMobileNav(!mobileNav) }}><img src="/favicon.svg" alt="" /></button><div className="rail-divider" />{servers.map(s => <button key={s.id} className={`server-button ${serverId === s.id && view === 'server' ? 'selected' : ''}`} title={s.name} aria-label={s.name} onClick={() => selectServer(s.id)}>{s.icon_url ? <img className="server-icon-img" src={serverIconUrl(s.icon_url)!} alt="" /> : s.name.toLowerCase().includes('f.dev') ? <span>F<span className="dot">.</span></span> : s.name.slice(0, 2).toUpperCase()}<i /></button>)}<button className="rail-add" title="Criar servidor" aria-label="Criar servidor" onClick={() => requireAccount(() => setDialog('server'))}><Plus size={23} /></button><button className={`rail-friends ${view === 'friends' ? 'selected' : ''}`} title="Amigos" aria-label="Amigos" onClick={() => { setView('friends'); setMobileNav(false) }}><Compass size={22} /></button><div className="rail-bottom"><button title="Como funciona" aria-label="Como funciona" onClick={() => setDialog('help')}><CircleHelp size={21} /></button><button title="Sair" aria-label="Sair" onClick={signOut}><LogOut size={20} /></button></div></aside>
    {mobileNav && <button className="mobile-backdrop" aria-label="Fechar canais" onClick={() => setMobileNav(false)} />}
    <aside className={`channel-sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand"><Brand /><button className="icon-button mobile-only" aria-label="Fechar menu" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
      {view === 'server' ? <>
      <button className="server-heading" onClick={() => currentServer ? (staff ? setDialog('serverSettings') : setDialog('help')) : requireAccount(() => setDialog('server'))}><div className="server-mini-icon">{currentServer?.icon_url ? <img src={serverIconUrl(currentServer.icon_url)!} alt="" /> : <Code2 size={21} />}</div><div><strong>{currentServer ? <StyledName profile={{ display_name: currentServer.name, name_color: currentServer.name_color, name_effect: currentServer.name_effect, name_font: currentServer.name_font }} /> : 'Seu espaço'}</strong><span>{demo ? 'Comunidade de demonstração' : 'Sua comunidade, conectada'}</span></div>{staff && currentServer ? <Settings2 size={15} /> : <ChevronDown size={15} />}</button>
      <div className="sidebar-scroll">
        <div className="community-banner"><span><Sparkles size={14} /> CONSTRUA SEU PRÓXIMO NÍVEL</span><strong>30 dias. Infinitas possibilidades.</strong><p>Uma comunidade. Um passo por dia.</p><div className="community-progress">{Array.from({ length: 30 }, (_, i) => <i key={i} className={i < 7 ? 'filled' : ''} />)}</div><small>DA PRIMEIRA IDEIA AO PRIMEIRO DEPLOY</small></div>
        <button className="sidebar-nav-item" onClick={() => { setView('friends'); setMobileNav(false) }}><Users size={18} />Amigos<ArrowRight size={15} /></button>
        <div className="channel-group"><div className="group-heading"><span><ChevronDown size={12} />CANAIS DE TEXTO</span>{can('manage_channels') && <button aria-label="Criar canal de texto" title="Criar canal" onClick={() => requireAccount(() => setDialog('channel'))}><Plus size={15} /></button>}</div>{channels.filter(c => c.server_id === serverId && c.kind === 'text').map(c => <button className={`channel-link ${view === 'server' && channelId === c.id ? 'active' : ''}`} key={c.id} onClick={() => selectChannel(c.id)}><Hash size={19} /><span>{c.name}</span>{c.name === 'avisos' && <span className="channel-tiny-dot" />}</button>)}</div>
        <div className="channel-group"><div className="group-heading"><span><ChevronDown size={12} />SALAS DE VOZ</span>{can('manage_channels') && <button title="Criar sala" aria-label="Criar sala de voz" onClick={() => requireAccount(() => setDialog('channel'))}><Plus size={15} /></button>}</div>{channels.filter(c => c.server_id === serverId && c.kind === 'voice').map(c => <div key={c.id}><button className={`channel-link voice-link ${view === 'server' && channelId === c.id ? 'active' : ''}`} onClick={() => selectChannel(c.id)}><Volume2 size={19} /><span>{c.name}</span>{room?.channel.id === c.id && <AudioLines size={16} className="green" />}</button>{demo && c.id === 'demo-class' && <div className="preview-members">{demoMembers.slice(0, 3).map(m => <div key={m.user_id}><Avatar name={m.profile.display_name} size="tiny" /><span>{m.profile.display_name}</span>{m.role === 'owner' && <span className="host-label">HOST</span>}</div>)}<span className="preview-caption">Participantes ilustrativos</span></div>}</div>)}</div>
        {currentServer && <button className="invite-sidebar" onClick={() => requireAccount(() => can('manage_invites') ? setDialog('invite') : toast.info('Peça um convite à equipe do servidor.'))}><UserPlus size={17} /><span>Convide sua comunidade</span><Plus size={14} /></button>}
      </div>
      </> : <>
      <button className="server-heading" onClick={() => requireAccount(() => setDialog('profile'))}><div className="server-mini-icon"><Avatar name={profile.display_name} url={profile.avatar_url} size="small" frame={profile.avatar_frame} /></div><div><strong><StyledName profile={profile} /></strong><span>Seu espaço pessoal</span></div><Settings2 size={15} /></button>
      <div className="sidebar-scroll">
        <button className={`sidebar-nav-item ${view === 'friends' ? 'active' : ''}`} onClick={() => { setView('friends'); setMobileNav(false) }}><Users size={18} />Amigos<ArrowRight size={15} /></button>
        <div className="channel-group"><div className="group-heading"><span><ChevronDown size={12} />MENSAGENS DIRETAS</span></div>{channels.filter(c => c.kind === 'direct').map(c => { const peer = dmPeers[c.id]; return <button key={c.id} className={`channel-link dm-link ${view === 'dm' && channelId === c.id ? 'active' : ''}`} onClick={() => selectChannel(c.id, 'direct')}><Avatar name={c.name} url={peer?.avatar_url} size="tiny" presence={presenceOf(peer)} /><span>{peer ? <StyledName profile={peer} /> : c.name}</span></button> })}{!channels.some(c => c.kind === 'direct') && <p className="sidebar-empty">Nenhuma conversa ainda. Abra o perfil de alguém e envie uma mensagem.</p>}</div>
      </div>
      </>}
      {room && <button className="connected-indicator" onClick={() => selectChannel(room.channel.id, room.channel.kind)}><AudioLines size={18} /><span><strong>Conectado à sala</strong><small>{room.channel.name}</small></span><ChevronRight size={15} /></button>}
      <div className="user-dock"><button className="profile-button" onClick={() => requireAccount(() => setDialog('profile'))}><Avatar name={profile.display_name} url={profile.avatar_url} size="small" presence={myStatus} frame={profile.avatar_frame} /><span><strong><StyledName profile={profile} /></strong><small>{profile.status_text || statusOptions.find(o => o.v === myStatus)?.label || 'Disponível'}</small></span></button><button className="icon-button status-toggle" title="Seu status" aria-label="Seu status" onClick={() => requireAccount(() => setStatusMenu(!statusMenu))}><i className={`presence-dot p-${myStatus}`} /></button><button className="icon-button" title="Meu perfil" aria-label="Meu perfil" onClick={() => requireAccount(() => setDialog('profile'))}><Settings2 size={18} /></button>
        {statusMenu && <div className="status-menu">{statusOptions.map(o => <button key={o.v} className={o.v === myStatus ? 'active' : ''} onClick={() => void setPresence(o.v)}><i className={`presence-dot p-${o.v}`} /><span><strong>{o.label}</strong><small>{o.hint}</small></span>{o.v === myStatus && <Check size={14} />}</button>)}</div>}
      </div>
    </aside>
    <div className="workspace">
      <header className="workspace-header"><div><button className="icon-button mobile-only" aria-label="Abrir canais" onClick={() => setMobileNav(true)}><Menu size={21} /></button>{view === 'friends' ? <Users size={21} /> : channel?.kind === 'direct' ? <Avatar name={channel.name} url={dmPeers[channel.id]?.avatar_url} size="tiny" presence={presenceOf(dmPeers[channel.id])} /> : voice ? <Volume2 size={22} /> : <Hash size={22} />}<strong>{view === 'friends' ? 'Amigos' : channel?.name || 'Bem-vindo ao seu espaço'}</strong>{view === 'server' && <><span className="header-separator" /><span className="channel-topic">{channel?.topic || 'Boas conexões começam aqui.'}</span></>}{view === 'dm' && <><span className="header-separator" /><span className="channel-topic">Conversa privada — só vocês dois.</span></>}</div><div>{demo && <span className="demo-tag">MODO DEMONSTRAÇÃO</span>}{view === 'dm' && channel && <button className="icon-button" aria-label="Ligar" title={room?.channel.id === channel.id ? 'Voltar para a chamada' : 'Ligar'} onClick={() => {
          if (room?.channel.id === channel.id) return selectChannel(channel.id, 'direct')
          void join()
          const peer = dmPeers[channel.id]
          if (peer) {
            setCalling({ channelId: channel.id, name: peer.display_name, avatar: peer.avatar_url })
            void sendSignal(peer.id, { type: 'call', channelId: channel.id, from: profile.id, name: profile.display_name, avatar: profile.avatar_url })
          }
        }}><Phone size={18} className={room?.channel.id === channel.id ? 'green' : ''} /></button>}<button className="icon-button" aria-label="Buscar mensagens" title="Buscar mensagens" disabled={!channel || view === 'friends'} onClick={() => requireAccount(() => setDialog('search'))}><Search size={19} /></button><button className="icon-button" aria-label="Ver membros" title="Ver membros" onClick={() => { setPanel('members'); setMobilePanel(!mobilePanel) }}><Users size={20} /></button>{demo ? <button className="header-login" onClick={exitDemo}>Entrar <ArrowRight size={14} /></button> : <span className="private-label"><ShieldCheck size={14} />Seu espaço</span>}</div></header>
      {inviteError && <div className="workspace-alert" role="alert">{inviteError}<button className="text-button" onClick={() => setInviteError('')}>Fechar</button></div>}
      {loadError && <div className="workspace-alert" role="alert">{loadError}<button className="text-button" onClick={() => void load()}>Tentar novamente</button></div>}
      <div className={`workspace-body ${(voice && view === 'server') || (view === 'dm' && activeRoomVisible) ? 'with-panel' : ''}`}>
        <main className="workspace-main">
          {room && <div className="live-container" style={{ display: activeRoomVisible ? 'flex' : 'none' }}>
            {calling && calling.channelId === room.channel.id && <div className="calling-overlay"><div className="calling-card"><Avatar name={calling.name} url={calling.avatar} /><div className="calling-info"><strong>{calling.name}</strong><span>Chamando…</span></div></div></div>}
            <Suspense fallback={<div className="center-muted">Preparando chamada…</div>}><LiveRoom key={room.channel.id} credentials={room} leave={leave}
            canModerate={room.channel.kind === 'direct' || can('moderate_voice')}
            moveTargets={channels.filter(c => c.kind === 'voice' && c.id !== room.channel.id)}
            onParticipants={setRoomParticipants}
            moderate={(action, targetUserId, destinationChannelId) => moderate(action, room.channel.id, targetUserId, destinationChannelId)} /></Suspense></div>}
          {view === 'friends' ? <Friends profile={profile} demo={demo} openDM={openDM} presenceOf={presenceOf} /> : channel?.kind === 'direct' && view === 'dm' ? (!activeRoomVisible && <Chat key={channel.id} channel={channel} profile={profile} demo={demo} canDeleteOthers={false} onDM={peer => void openDM(peer)} />) : !channel ? <div className="empty-workspace"><div className="empty-logo"><AudioLines size={44} /></div><span className="eyebrow">SEU ESPAÇO PARA IR ALÉM</span><h1>{loading ? 'Preparando suas conexões…' : 'Toda comunidade começa com alguém.'}</h1><p>{loading ? 'Só um instante.' : 'Crie um servidor para sua turma ou abra o link de convite que recebeu.'}</p>{!loading && <button className="primary" onClick={() => requireAccount(() => setDialog('server'))}><Plus size={18} />Criar meu primeiro servidor</button>}</div> : voice ? !activeRoomVisible && <ClassroomLobby channel={channel} members={channel.kind === 'direct' ? [] : members} demo={demo} joining={joining} join={() => void join()} /> : <Chat key={channel.id} channel={channel} profile={profile} demo={demo} canDeleteOthers={can('kick_members')} onDM={peer => void openDM(peer)} />}
        </main>
        {channel && ((voice && view === 'server') || (view === 'dm' && activeRoomVisible)) && <aside className={`conversation-panel ${mobilePanel ? 'mobile-panel-open' : ''}`}><div className="panel-tabs"><button className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}><MessageSquare size={15} />Chat</button><button className={panel === 'notes' ? 'active' : ''} onClick={() => setPanel('notes')}><BookOpen size={15} />Notas</button><button className={panel === 'members' ? 'active' : ''} onClick={() => setPanel('members')}><Users size={15} />Pessoas</button><button className="icon-button mobile-only" aria-label="Fechar painel" onClick={() => setMobilePanel(false)}><X size={16} /></button></div>{panel === 'chat' ? <><div className="panel-subheading"><span>O PAPO CONTINUA AQUI</span><MessageCircle size={14} /></div><Chat key={channel.id} channel={channel} profile={profile} demo={demo} compact canDeleteOthers={can('kick_members')} onDM={peer => void openDM(peer)} /></> : panel === 'notes' ? <Notes key={channel.id} channelId={channel.id} userId={profile.id} canEdit={can('edit_notes') || channel.kind === 'direct'} demo={demo} /> : <MembersPanel channel={channel} members={members} roles={roles} memberRoles={memberRoles} can={can} profile={profile} demo={demo} openRoles={() => setDialog('roles')} openProfile={() => setDialog('profile')} changed={() => void refreshRoles()} openDM={peer => void openDM(peer)} presenceOf={presenceOf}
            voice={room ? { channelId: room.channel.id, inRoom: (id: string) => roomParticipants.includes(id), moveTargets: channels.filter(c => c.kind === 'voice' && c.id !== room.channel.id), moderate } : undefined} />}<div className="panel-footer"><span className="tiny-brand">d.</span><span>Conexões que fazem a diferença.</span></div></aside>}
      </div>
      <footer className="workspace-footer"><span><span className="status-dot" />{demo ? 'Você está conhecendo o discodigital' : 'Um espaço feito para sua comunidade'}</span><span><Headphones size={13} />Menos distância. Mais possibilidades.<span className="footer-version">DDTAL / 0.1</span></span></footer>
      {((voice && view === 'server') || (view === 'dm' && activeRoomVisible)) && <button className="mobile-chat-toggle" aria-label="Abrir chat da sala" onClick={() => { setPanel('chat'); setMobilePanel(true) }}><MessageSquare size={20} /></button>}
    </div>
    {dialog === 'server' && <CreateServer close={() => setDialog(null)} created={id => { setChannelId(null); setView('server'); void load(id) }} />}
    {dialog === 'channel' && serverId && <CreateChannel serverId={serverId} close={() => setDialog(null)} created={() => void load()} />}
    {dialog === 'invite' && currentServer && <Invite serverId={currentServer.id} serverName={currentServer.name} close={() => setDialog(null)} />}
    {dialog === 'serverSettings' && currentServer && staff && <ServerSettings server={currentServer} close={() => setDialog(null)} updated={() => void load()} />}
    {dialog === 'profile' && <ProfileSettings profile={profile} close={() => setDialog(null)} updated={updateProfile} />}
    {dialog === 'search' && channel && <SearchMessages channel={channel} close={() => setDialog(null)} />}
    {dialog === 'roles' && serverId && <ManageRoles serverId={serverId} roles={roles} close={() => setDialog(null)} changed={() => void refreshRoles()} />}
    {incomingCall && <div className="call-overlay"><div className="call-card">
      <Avatar name={incomingCall.name} url={incomingCall.avatar} size="small" presence="online" />
      <div className="call-info"><strong>{incomingCall.name}</strong><span>está te ligando…</span></div>
      <div className="call-actions">
        <button className="call-decline" onClick={() => declineCall()} title="Recusar" aria-label="Recusar ligação"><PhoneOff size={19} /></button>
        <button className="call-accept" onClick={acceptCall} title="Atender" aria-label="Atender ligação"><Phone size={19} /></button>
      </div>
    </div></div>}
    {dialog === 'help' && <Modal title="Seu espaço, na mesma frequência." close={() => setDialog(null)}><div className="help-content"><Brand /><p>O discodigital conecta sua comunidade por texto, voz e tela. Um espaço para aprender fazendo.</p><div><Radio /><span><strong>Entre em uma sala</strong>Ative seu microfone, câmera ou compartilhe a tela. O navegador pede sua permissão.</span></div><div><BookOpen /><span><strong>Aprenda junto</strong>Use o ponteiro e a caneta sobre uma transmissão. Registre os pontos importantes nas notas da turma.</span></div><div><Users /><span><strong>Traga sua comunidade</strong>Crie um servidor e compartilhe o convite. Para conversas privadas, adicione amigos pelo identificador.</span></div><p className="muted">{demo ? 'Esta é uma prévia interativa com conteúdo ilustrativo. Crie sua conta para usar as conexões reais.' : 'Imagens são enviadas sem redimensionamento. Transmissões podem chegar a 1080p, conforme o navegador e a conexão.'}</p><span className="help-signature"><Check size={15} />Construído para a comunidade F.dev</span></div></Modal>}
  </div>
}
