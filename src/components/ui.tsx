import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, MessageCircle, UserPlus, UserX, X } from 'lucide-react'
import { toast } from 'sonner'
import { avatarUrl, db, errorMessage, rpc } from '../lib/supabase'
import type { Friendship, Profile } from '../lib/types'

export function Avatar({ name, size = '', online = false, presence, url, frame }: { name: string; size?: string; online?: boolean; presence?: Profile['presence']; url?: string | null; frame?: Profile['avatar_frame'] }) {
  const hue = [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 360
  const src = url && url.startsWith('http') ? url : avatarUrl(url)
  return <span className={`avatar ${size} ${src ? 'has-image' : ''} frame-${frame || 'none'}`} style={{ background: `hsl(${hue} 24% 24%)`, color: `hsl(${hue} 65% 83%)` }}>
    {src ? <img src={src} alt="" loading="lazy" /> : name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
    {presence ? <i className={`presence-dot p-${presence}`} /> : online && <i className="online-dot" />}
  </span>
}

// Discord-style profile card: banner, framed avatar, styled name, status and bio.
// `actions` renders moderation/action buttons below the identity block.
export function ProfileCard({ profile, actions, children }: { profile: Profile; actions?: ReactNode; children?: ReactNode }) {
  const accent = profile.card_color || profile.name_color || '#b69afb'
  const banner = profile.banner_url && (profile.banner_url.startsWith('http') ? profile.banner_url : avatarUrl(profile.banner_url))
  return <div className={`profile-card fx-card-${profile.card_effect || 'none'}`} style={{ '--card-accent': accent } as React.CSSProperties}>
    <div className="pc-banner">{banner ? <><img className="pc-banner-bg" src={banner} alt="" /><img className="pc-banner-img" src={banner} alt="" /></> : <i className="pc-banner-fill" />}</div>
    <div className="pc-body">
      <Avatar name={profile.display_name} url={profile.avatar_url} size="pc" frame={profile.avatar_frame} />
      <div className="pc-identity">
        <strong className="pc-name"><StyledName profile={profile} /></strong>
        <span className="pc-handle">@{profile.handle}</span>
      </div>
      {profile.status_text && <span className="pc-status"><i />{profile.status_text}</span>}
      {profile.bio && <div className="pc-bio"><span className="pc-section">SOBRE MIM</span><p>{profile.bio}</p></div>}
      {children}
      {actions && <div className="pc-actions">{actions}</div>}
    </div>
  </div>
}

// Renders a display name with the owner's color, font and effect choices.
export function StyledName({ profile, className = '' }: { profile: Pick<Profile, 'display_name' | 'name_color' | 'name_effect' | 'name_font'>; className?: string }) {
  const effect = profile.name_effect || 'none'
  const font = profile.name_font || 'default'
  const style = profile.name_color && effect !== 'rainbow' ? { color: profile.name_color } : undefined
  if (effect === 'wave') {
    return <span className={`styled-name fx-wave font-${font} ${className}`} style={style}>
      {[...profile.display_name].map((c, i) => <i key={i} style={{ animationDelay: `${i * 0.07}s` }}>{c === ' ' ? ' ' : c}</i>)}
    </span>
  }
  return <span className={`styled-name fx-${effect} font-${font} ${className}`} style={style}>{profile.display_name}</span>
}

// DM + friendship actions shown inside another person's profile card.
// Loads the current friendship state and offers: send DM (friends or
// same-server peers), send/accept/cancel/remove friendship.
export function PeerActions({ me, peer, demo = false, onDM, onDone }: {
  me: Profile; peer: Profile; demo?: boolean
  onDM?: (peer: Profile) => void; onDone?: () => void
}) {
  const [rel, setRel] = useState<Friendship | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const self = me.id === peer.id
  const load = useCallback(async () => {
    if (demo || self) return
    const { data } = await db().from('ddtal_friendships').select('*')
      .or(`and(requester_id.eq.${me.id},recipient_id.eq.${peer.id}),and(requester_id.eq.${peer.id},recipient_id.eq.${me.id})`)
      .limit(1)
    setRel((data?.[0] as Friendship | undefined) || null)
    setLoaded(true)
  }, [demo, self, me.id, peer.id])
  useEffect(() => { void load() }, [load])
  if (demo || self) return null
  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    try { await task(); await load() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const addFriend = () => void run(async () => {
    await rpc('ddtal_request_friend', { p_handle: peer.handle })
    toast.success('Solicitação enviada.')
  })
  const accept = () => void run(async () => {
    if (!rel) return
    await rpc('ddtal_accept_friend', { p_friendship: rel.id })
    toast.success('Amizade aceita.')
  })
  const remove = () => void run(async () => {
    if (!rel) return
    const { error } = await db().from('ddtal_friendships').delete().eq('id', rel.id)
    if (error) throw error
    toast.success(rel.status === 'accepted' ? 'Amizade removida.' : 'Solicitação cancelada.')
  })
  const dm = () => { onDM?.(peer); onDone?.() }
  return <div className="peer-actions">
    <button className="primary" disabled={busy} onClick={dm}><MessageCircle size={15} />Enviar mensagem</button>
    {!loaded ? null : !rel ? <button disabled={busy} onClick={addFriend}><UserPlus size={15} />Adicionar amigo</button>
      : rel.status === 'accepted' ? <button className="danger" disabled={busy} onClick={remove}><UserX size={15} />Remover amizade</button>
      : rel.recipient_id === me.id ? <>
        <button disabled={busy} onClick={accept}><Check size={15} />Aceitar solicitação</button>
        <button className="danger" disabled={busy} onClick={remove}><X size={15} />Recusar</button></>
      : <button disabled={busy} onClick={remove}><X size={15} />Cancelar solicitação</button>}
  </div>
}

export function Modal({ title, children, close, bare = false }: { title?: string; children: ReactNode; close: () => void; bare?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => ref.current?.close()
  }, [])
  return <dialog ref={ref} className={`modal ${bare ? 'bare' : ''}`} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close() }}>
    {bare
      ? <button className="icon-button modal-x" aria-label="Fechar" onClick={close}><X size={18} /></button>
      : <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fechar" onClick={close}><X size={20} /></button></div>}
    {children}
  </dialog>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><img src="/favicon.svg" alt="" />{!compact && <span>disco<span className="brand-light">digital</span><small>BETA</small></span>}</div>
}
