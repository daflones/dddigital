import { useCallback, useEffect, useState } from 'react'
import { Check, MessageCircle, Phone, Search, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { db, errorMessage, rpc } from '../lib/supabase'
import type { Friendship, Profile } from '../lib/types'
import { Avatar } from './ui'

export function Friends({ profile, demo, openDM }: { profile: Profile; demo: boolean; openDM: (peer: Profile, call?: boolean) => void }) {
  const [friends, setFriends] = useState<Friendship[]>([])
  const [handle, setHandle] = useState('')
  const [tab, setTab] = useState('accepted')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(demo)
  const load = useCallback(async () => {
    if (demo) return
    const { data, error } = await db().from('ddtal_friendships').select('*,requester:ddtal_profiles!requester_id(*),recipient:ddtal_profiles!recipient_id(*)').order('created_at', { ascending: false })
    if (error) toast.error(error.message)
    else {
      setFriends(data.map(f => ({ ...f, peer: f.requester_id === profile.id ? f.recipient : f.requester })) as Friendship[])
      setLoaded(true)
    }
  }, [demo, profile.id])
  useEffect(() => {
    void load()
    if (demo) return
    const sub = db().channel('ddtal-friends').on('postgres_changes', { event: '*', schema: 'public', table: 'ddtal_friendships' }, () => void load()).subscribe(status => { if (status === 'SUBSCRIBED') void load() })
    return () => { void db().removeChannel(sub) }
  }, [load, demo])
  async function request(event: React.FormEvent) {
    event.preventDefault()
    if (demo) return toast.info('Crie sua conta para adicionar amigos.')
    setBusy(true)
    try { await rpc('ddtal_request_friend', { p_handle: handle.replace(/^@/, '') }); setHandle(''); toast.success('Solicitação enviada.'); await load() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  async function respond(friend: Friendship, accept: boolean) {
    setBusy(true)
    try {
      if (accept) await rpc('ddtal_accept_friend', { p_friendship: friend.id })
      else { const { error } = await db().from('ddtal_friendships').delete().eq('id', friend.id); if (error) throw error }
      await load()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const visible = friends.filter(f => f.status === tab)
  return <div className="friends-page">
    <div className="eyebrow">BOAS CONEXÕES VÃO LONGE</div><h1>Seu círculo de builders.</h1><p className="muted">Uma conversa pode ser o começo de uma grande ideia.</p>
    <form className="friend-form" onSubmit={request}><UserPlus size={20} /><input aria-label="Identificador do amigo" placeholder="Digite o @identificador de um amigo" required minLength={3} maxLength={33} value={handle} onChange={e => setHandle(e.target.value.toLowerCase())} /><button className="primary" disabled={busy}>Adicionar amigo</button></form>
    <p className="your-handle">Seu identificador: <button className="text-button" onClick={() => void navigator.clipboard.writeText(profile.handle).then(() => toast.success('Identificador copiado.')).catch(() => toast.error('Não foi possível copiar.'))}>@{profile.handle}</button></p>
    <div className="friends-tabs"><button className={tab === 'accepted' ? 'active' : ''} onClick={() => setTab('accepted')}><Users size={16} />Amigos <span>{friends.filter(f => f.status === 'accepted').length}</span></button><button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>Solicitações <span>{friends.filter(f => f.status === 'pending').length}</span></button></div>
    {!loaded ? <div className="center-muted">Carregando suas conexões…</div> : visible.length ? <div className="friends-list">{visible.map(friend => <div className="friend-row" key={friend.id}><Avatar name={friend.peer.display_name} /><div><strong>{friend.peer.display_name}</strong><span>@{friend.peer.handle}{friend.status === 'pending' && ` · ${friend.requester_id === profile.id ? 'Enviada' : 'Recebida'}`}</span></div>{friend.status === 'accepted' ? <><button className="icon-button" title="Conversar" aria-label={`Conversar com ${friend.peer.display_name}`} onClick={() => openDM(friend.peer)}><MessageCircle size={20} /></button><button className="icon-button" title="Iniciar ligação" aria-label={`Ligar para ${friend.peer.display_name}`} onClick={() => openDM(friend.peer, true)}><Phone size={19} /></button></> : <>{friend.recipient_id === profile.id && <button className="icon-button" title="Aceitar" aria-label={`Aceitar ${friend.peer.display_name}`} disabled={busy} onClick={() => void respond(friend, true)}><Check size={20} /></button>}<button className="icon-button" title="Recusar ou cancelar" aria-label="Recusar ou cancelar solicitação" disabled={busy} onClick={() => void respond(friend, false)}><X size={20} /></button></>}</div>)}</div> : <div className="friends-empty"><div><Search size={34} /></div><h2>{tab === 'pending' ? 'Tudo em dia por aqui.' : 'Encontre sua próxima conexão.'}</h2><p>{tab === 'pending' ? 'As novas solicitações aparecem neste espaço.' : 'Peça o identificador de alguém da turma e comece uma conversa.'}</p></div>}
  </div>
}
