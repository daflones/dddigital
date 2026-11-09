import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, MoreVertical, ShieldCheck, ShieldPlus, UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, rpc } from '../lib/supabase'
import { Avatar } from './ui'
import type { Channel, Membership, MemberRole, Profile, Role, RoleFlag } from '../lib/types'

// Members sidebar: role badges + moderation (assign roles, remove from server).
export function MembersPanel({ channel, members, roles, memberRoles, can, profile, demo, openRoles, changed }: {
  channel: Channel; members: Membership[]; roles: Role[]; memberRoles: MemberRole[]
  can: (flag: RoleFlag) => boolean; profile: Profile; demo: boolean
  openRoles: () => void; changed: () => void
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const canManageRoles = can('manage_roles')
  const canKick = can('kick_members')
  useEffect(() => {
    if (!menuFor) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuFor])
  const rolesOf = (userId: string) => memberRoles
    .filter(mr => mr.user_id === userId)
    .map(mr => roles.find(r => r.id === mr.role_id))
    .filter((r): r is Role => Boolean(r))
    .sort((a, b) => a.position - b.position)
  async function toggleRole(userId: string, role: Role) {
    const has = memberRoles.some(mr => mr.user_id === userId && mr.role_id === role.id)
    try {
      await rpc(has ? 'ddtal_unassign_role' : 'ddtal_assign_role', { p_role: role.id, p_user: userId })
      changed()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  async function kick(member: Membership) {
    setMenuFor(null)
    try {
      await rpc('ddtal_remove_member', { p_server: channel.server_id, p_user: member.user_id })
      toast.success(`${member.profile.display_name} foi removido do servidor.`)
      changed()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  return <div className="members-panel">
    <div className="eyebrow">{channel.kind === 'direct' ? 'CONVERSA PRIVADA' : `MEMBROS DO SERVIDOR — ${members.length}`}</div>
    {channel.kind === 'direct' ? <p className="muted">Esta conversa é visível apenas para você e {channel.name}.</p> : <>
      {canManageRoles && <button className="manage-roles-button" onClick={openRoles}><ShieldPlus size={15} />Gerenciar cargos</button>}
      {members.map(m => {
        const badges = rolesOf(m.user_id)
        const isOwner = m.role === 'owner'
        const actionable = (canManageRoles || canKick) && !isOwner && m.user_id !== profile.id
        return <div className="member-row" key={m.user_id}>
          <Avatar name={m.profile.display_name} size="small" />
          <div>
            <strong>{m.profile.display_name}{m.user_id === profile.id && ' (você)'}</strong>
            <span>{isOwner ? 'Criador · professor' : m.role === 'moderator' ? 'Equipe' : `@${m.profile.handle}`}</span>
            {badges.length > 0 && <div className="role-badges">{badges.map(r => <i key={r.id} className="role-badge" style={{ color: r.color, borderColor: r.color }}><BadgeCheck size={11} />{r.name}</i>)}</div>}
          </div>
          {isOwner && <ShieldCheck size={15} className="owner-icon" />}
          {actionable && <button className="icon-button member-menu-button" aria-label={`Ações de ${m.profile.display_name}`} onClick={() => setMenuFor(menuFor === m.user_id ? null : m.user_id)}><MoreVertical size={16} /></button>}
          {menuFor === m.user_id && actionable && <div className="member-menu" ref={menuRef}>
            {canManageRoles && roles.length > 0 && <><span className="menu-label">Cargos</span>
              {roles.map(r => {
                const has = memberRoles.some(mr => mr.user_id === m.user_id && mr.role_id === r.id)
                return <button key={r.id} onClick={() => void toggleRole(m.user_id, r)}><i className="role-dot" style={{ background: r.color }} />{r.name}<span className={`menu-check ${has ? 'on' : ''}`}>{has ? 'sim' : 'não'}</span></button>
              })}</>}
            {canManageRoles && roles.length === 0 && <span className="menu-label">Crie um cargo primeiro</span>}
            {canKick && <button className="danger" onClick={() => void kick(m)}><UserMinus size={15} />Remover do servidor</button>}
          </div>}
        </div>
      })}
    </>}
    {demo && <p className="muted">Perfis de exemplo. Nenhuma chamada está acontecendo nesta prévia.</p>}
  </div>
}
