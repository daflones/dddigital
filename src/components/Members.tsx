import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, Check, MoreVertical, PenLine, ShieldCheck, ShieldPlus, UserCog, UserMinus, Volume1, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, rpc } from '../lib/supabase'
import { Avatar, PeerActions, ProfileCard, StyledName } from './ui'
import type { Channel, Membership, MemberRole, Profile, Role, RoleFlag } from '../lib/types'

type ModerateAction = 'mute_mic' | 'unmute_mic' | 'kick' | 'move'
export type MemberVoice = {
  channelId: string | null
  inRoom: (userId: string) => boolean
  moveTargets: Channel[]
  moderate: (action: ModerateAction, channelId: string, targetUserId: string, destinationChannelId?: string) => Promise<unknown>
}

// Members sidebar: every row opens a management card — nickname, roles,
// voice moderation and server removal, each gated by the viewer's permissions.
export function MembersPanel({ channel, members, roles, memberRoles, can, profile, demo, openRoles, openProfile, changed, voice, openDM }: {
  channel: Channel; members: Membership[]; roles: Role[]; memberRoles: MemberRole[]
  can: (flag: RoleFlag) => boolean; profile: Profile; demo: boolean
  openRoles: () => void; openProfile: () => void; changed: () => void; voice?: MemberVoice
  openDM?: (peer: Profile) => void
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [nickDraft, setNickDraft] = useState('')
  const [nickSaving, setNickSaving] = useState(false)
  const [moving, setMoving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const canManageRoles = can('manage_roles')
  const canKick = can('kick_members')
  const canNickname = can('manage_nicknames')
  const canVoice = can('moderate_voice')
  useEffect(() => {
    if (!menuFor) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuFor(null) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menuFor])
  const rolesOf = (userId: string) => memberRoles
    .filter(mr => mr.user_id === userId)
    .map(mr => roles.find(r => r.id === mr.role_id))
    .filter((r): r is Role => Boolean(r))
    .sort((a, b) => a.position - b.position)
  function openMenu(m: Membership) {
    setNickDraft(m.nickname || '')
    setMoving(false)
    setMenuFor(menuFor === m.user_id ? null : m.user_id)
  }
  async function saveNickname(m: Membership) {
    setNickSaving(true)
    try {
      await rpc('ddtal_set_nickname', { p_server: channel.server_id, p_user: m.user_id, p_nickname: nickDraft })
      toast.success(nickDraft.trim() ? 'Apelido atualizado.' : 'Apelido removido.')
      changed()
    } catch (e) { toast.error(errorMessage(e)) } finally { setNickSaving(false) }
  }
  async function toggleRole(userId: string, role: Role) {
    const has = memberRoles.some(mr => mr.user_id === userId && mr.role_id === role.id)
    try {
      await rpc(has ? 'ddtal_unassign_role' : 'ddtal_assign_role', { p_role: role.id, p_user: userId })
      changed()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  async function setMemberRole(m: Membership, role: 'member' | 'moderator') {
    try {
      await rpc('ddtal_set_member_role', { p_server: channel.server_id, p_user: m.user_id, p_role: role })
      toast.success(role === 'moderator' ? `${m.profile.display_name} agora é moderador.` : `${m.profile.display_name} voltou a ser membro.`)
      changed()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  async function voiceAction(m: Membership, action: ModerateAction, destinationChannelId?: string) {
    if (!voice?.channelId) return
    setMenuFor(null)
    try {
      const result = await voice.moderate(action, voice.channelId, m.user_id, destinationChannelId) as { channelName?: string }
      const name = m.nickname || m.profile.display_name
      toast.success(action === 'mute_mic' ? `${name} foi silenciado.`
        : action === 'unmute_mic' ? `Voz devolvida a ${name}.`
        : action === 'kick' ? `${name} foi expulso da sala.`
        : `${name} movido para ${result?.channelName || 'outra sala'}.`)
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
        const isSelf = m.user_id === profile.id
        const inRoom = Boolean(voice?.channelId && voice.inRoom(m.user_id))
        const actionable = isSelf || canManageRoles || canNickname || (canKick && !isOwner) || (canVoice && inRoom && !isSelf)
        return <div className={`member-row ${actionable ? 'actionable' : ''}`} key={m.user_id} onClick={() => actionable && openMenu(m)}>
          <Avatar name={m.profile.display_name} url={m.profile.avatar_url} size="small" frame={m.profile.avatar_frame} />
          <div>
            <strong>{m.nickname ? <span>{m.nickname}</span> : <StyledName profile={m.profile} />}{isSelf && ' (você)'}</strong>
            <span>{isOwner ? 'Criador · professor' : m.role === 'moderator' ? 'Equipe' : `${m.nickname ? m.profile.display_name + ' · ' : ''}@${m.profile.handle}`}</span>
            {badges.length > 0 && <div className="role-badges">{badges.map(r => <i key={r.id} className="role-badge" style={{ color: r.color, borderColor: r.color }}><BadgeCheck size={11} />{r.name}</i>)}</div>}
          </div>
          {isOwner && <ShieldCheck size={15} className="owner-icon" />}
          {actionable && <button className="icon-button member-menu-button" aria-label={`Ações de ${m.profile.display_name}`} onClick={e => { e.stopPropagation(); openMenu(m) }}><MoreVertical size={16} /></button>}
          {menuFor === m.user_id && <div className="member-menu member-card" ref={menuRef} onClick={e => e.stopPropagation()}>
            <ProfileCard profile={m.profile}>
              {m.nickname && <span className="pc-note">a.k.a. {m.nickname}</span>}
              {(isOwner || m.role === 'moderator' || badges.length > 0) && <div className="role-badges">{isOwner && <i className="role-badge pc-role"><ShieldCheck size={11} />Criador</i>}{m.role === 'moderator' && <i className="role-badge pc-role"><ShieldCheck size={11} />Moderador</i>}{badges.map(r => <i key={r.id} className="role-badge" style={{ color: r.color, borderColor: r.color }}><BadgeCheck size={11} />{r.name}</i>)}</div>}
            </ProfileCard>
            <PeerActions me={profile} peer={m.profile} demo={demo} onDM={openDM} onDone={() => setMenuFor(null)} />
            {isSelf && <button onClick={() => { setMenuFor(null); openProfile() }}><UserCog size={15} />Editar meu perfil</button>}
            {(isSelf || canNickname) && <div className="nickname-editor">
              <span className="menu-label"><PenLine size={11} /> Apelido no servidor</span>
              <div className="nickname-row"><input value={nickDraft} maxLength={40} placeholder={m.profile.display_name} onChange={e => setNickDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void saveNickname(m) }} /><button className="icon-button" aria-label="Salvar apelido" disabled={nickSaving} onClick={() => void saveNickname(m)}><Check size={15} /></button></div>
            </div>}
            {canManageRoles && (!isOwner || isSelf) && <><span className="menu-label">Cargos</span>
              {roles.map(r => {
                const has = memberRoles.some(mr => mr.user_id === m.user_id && mr.role_id === r.id)
                return <button key={r.id} onClick={() => void toggleRole(m.user_id, r)}><i className="role-dot" style={{ background: r.color }} />{r.name}<span className={`menu-check ${has ? 'on' : ''}`}>{has ? 'sim' : 'não'}</span></button>
              })}
              {roles.length === 0 && <span className="menu-label">Crie um cargo primeiro</span>}
              {!isSelf && <button onClick={() => void setMemberRole(m, m.role === 'moderator' ? 'member' : 'moderator')}><ShieldCheck size={15} />{m.role === 'moderator' ? 'Rebaixar para membro' : 'Promover a moderador'}</button>}</>}
            {canVoice && inRoom && !isSelf && <><span className="menu-label">Na sala de voz</span>
              <button onClick={() => void voiceAction(m, 'mute_mic')}><VolumeX size={15} />Silenciar</button>
              <button onClick={() => void voiceAction(m, 'unmute_mic')}><Volume1 size={15} />Devolver a voz</button>
              {voice!.moveTargets.length > 0 && <button onClick={() => setMoving(!moving)}><Volume2 size={15} />Mover para…</button>}
              {moving && <div className="moderate-submenu">{voice!.moveTargets.map(c => <button key={c.id} onClick={() => void voiceAction(m, 'move', c.id)}><Volume2 size={14} />{c.name}</button>)}</div>}
              <button className="danger" onClick={() => void voiceAction(m, 'kick')}><UserMinus size={15} />Expulsar da sala</button></>}
            {canKick && !isOwner && !isSelf && <button className="danger" onClick={() => void kick(m)}><UserMinus size={15} />Remover do servidor</button>}
          </div>}
        </div>
      })}
    </>}
    {demo && <p className="muted">Perfis de exemplo. Nenhuma chamada está acontecendo nesta prévia.</p>}
  </div>
}
