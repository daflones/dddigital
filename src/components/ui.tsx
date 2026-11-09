import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { avatarUrl } from '../lib/supabase'
import type { Profile } from '../lib/types'

export function Avatar({ name, size = '', online = false, url, frame }: { name: string; size?: string; online?: boolean; url?: string | null; frame?: Profile['avatar_frame'] }) {
  const hue = [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 360
  const src = url && url.startsWith('http') ? url : avatarUrl(url)
  return <span className={`avatar ${size} ${src ? 'has-image' : ''} frame-${frame || 'none'}`} style={{ background: `hsl(${hue} 24% 24%)`, color: `hsl(${hue} 65% 83%)` }}>
    {src ? <img src={src} alt="" loading="lazy" /> : name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
    {online && <i className="online-dot" />}
  </span>
}

// Discord-style profile card: banner, framed avatar, styled name, status and bio.
// `actions` renders moderation/action buttons below the identity block.
export function ProfileCard({ profile, actions, children }: { profile: Profile; actions?: ReactNode; children?: ReactNode }) {
  const accent = profile.card_color || profile.name_color || '#b69afb'
  const banner = profile.banner_url && (profile.banner_url.startsWith('http') ? profile.banner_url : avatarUrl(profile.banner_url))
  return <div className={`profile-card fx-card-${profile.card_effect || 'none'}`} style={{ '--card-accent': accent } as React.CSSProperties}>
    <div className="pc-banner">{banner ? <img src={banner} alt="" /> : <i className="pc-banner-fill" />}</div>
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

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => ref.current?.close()
  }, [])
  return <dialog ref={ref} className="modal" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fechar" onClick={close}><X size={20} /></button></div>
    {children}
  </dialog>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><img src="/favicon.svg" alt="" />{!compact && <span>disco<span className="brand-light">digital</span><small>BETA</small></span>}</div>
}
