import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Link, Mic, Plus, Search, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { db, errorMessage, rpc, avatarUrl, serverIconUrl } from '../lib/supabase'
import type { Channel, Message, Profile, Role, RoleFlag, Server } from '../lib/types'
import { Modal, ProfileCard, StyledName } from './ui'
import { GifPanel } from './Pickers'
import { VoiceSettings } from './VoiceSettings'

export function CreateServer({ close, created }: { close: () => void; created: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const values = new FormData(e.currentTarget); setBusy(true)
    try {
      const id = await rpc<string>('ddtal_create_server', { p_name: values.get('name'), p_description: values.get('description') })
      created(id); close(); toast.success('Seu espaço está pronto. Convide a comunidade!')
    } catch (error) { toast.error(errorMessage(error)) } finally { setBusy(false) }
  }
  return <Modal title="Um espaço com a sua cara." close={close}><p className="muted">Reúna sua comunidade. Os primeiros canais de texto e voz já vêm prontos.</p><form onSubmit={submit}><label>Nome do servidor<input name="name" required minLength={2} maxLength={60} placeholder="Ex.: F.dev • Builders" autoFocus /></label><label>Uma breve descrição<textarea name="description" maxLength={240} placeholder="O que vamos construir juntos?" rows={3} /></label><button className="primary full" disabled={busy}><Plus size={18} />{busy ? 'Criando…' : 'Criar meu servidor'}</button></form></Modal>
}
export function CreateChannel({ serverId, close, created }: { serverId: string; close: () => void; created: () => void }) {
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const values = new FormData(e.currentTarget); setBusy(true)
    try {
      const { error } = await db().from('ddtal_channels').insert({ server_id: serverId, name: values.get('name'), kind: values.get('kind'), topic: values.get('topic') })
      if (error) throw error
      created(); close(); toast.success('Canal criado.')
    } catch (error) { toast.error(errorMessage(error)) } finally { setBusy(false) }
  }
  return <Modal title="Uma nova conversa começa aqui." close={close}><form onSubmit={submit}><label>Nome do canal<input name="name" required maxLength={60} placeholder="Ex.: laboratório-de-ideias" autoFocus /></label><label>Tipo<select name="kind"><option value="text">Canal de texto</option><option value="voice">Sala de voz e vídeo</option></select></label><label>Sobre este canal<input name="topic" maxLength={240} placeholder="Um espaço para…" /></label><button className="primary full" disabled={busy}>{busy ? 'Criando…' : 'Criar canal'}</button></form></Modal>
}
// Server branding: icon (image or GIF), styled name and description. Staff only.
async function uploadServerIcon(serverId: string, file: File): Promise<string> {
  if (file.type === 'image/gif') {
    const path = `${serverId}/icon.gif`
    const { error } = await db().storage.from('ddtal-server-assets').upload(path, file, { upsert: true, contentType: 'image/gif' })
    if (error) throw error
    return path
  }
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Não consegui processar a imagem.')), 'image/webp', 0.9))
  const path = `${serverId}/icon.webp`
  const { error } = await db().storage.from('ddtal-server-assets').upload(path, blob, { upsert: true, contentType: 'image/webp' })
  if (error) throw error
  return path
}
export function ServerSettings({ server, close, updated }: { server: Server; close: () => void; updated: () => void }) {
  const [busy, setBusy] = useState(false)
  const [icon, setIcon] = useState<PendingMedia>({})
  const [gifFor, setGifFor] = useState(false)
  const [preview, setPreview] = useState<Server>({ ...server })
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const values = new FormData(e.currentTarget); setBusy(true)
    try {
      let icon_url = preview.icon_url
      if (icon.file) icon_url = await uploadServerIcon(server.id, icon.file)
      else if (icon.external) {
        // External GIFs are re-hosted into our bucket so the icon never depends on a third party.
        const res = await fetch(icon.external)
        if (!res.ok) throw new Error('Não consegui baixar o GIF.')
        const blob = await res.blob()
        const path = `${server.id}/icon.gif`
        const { error } = await db().storage.from('ddtal-server-assets').upload(path, blob, { upsert: true, contentType: 'image/gif' })
        if (error) throw error
        icon_url = path
      } else if (icon.removed) icon_url = null
      const { error } = await db().from('ddtal_servers').update({
        name: values.get('name'), description: values.get('description'), icon_url,
        name_color: values.get('use_color') === 'on' ? values.get('color') : null,
        name_effect: values.get('effect'), name_font: values.get('font'),
      }).eq('id', server.id)
      if (error) throw error
      updated(); toast.success('Servidor atualizado.'); close()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const refresh = (form: HTMLFormElement) => {
    const v = new FormData(form)
    setPreview({ ...preview, name: String(v.get('name')) || 'Servidor', description: String(v.get('description') || ''), name_color: v.get('use_color') === 'on' ? String(v.get('color')) : null, name_effect: v.get('effect') as Server['name_effect'], name_font: v.get('font') as Server['name_font'] })
  }
  const iconPreview = mediaPreview(icon, preview.icon_url?.startsWith('http') ? preview.icon_url : serverIconUrl(preview.icon_url))
  return <Modal title={`Personalizar ${server.name}`} close={close}>
    <div className="server-preview">
      <div className="invite-server-icon">{iconPreview ? <img src={iconPreview} alt="" /> : preview.name.slice(0, 2).toUpperCase()}</div>
      <div><strong><StyledName profile={{ display_name: preview.name, name_color: preview.name_color, name_effect: preview.name_effect, name_font: preview.name_font }} /></strong><p className="muted">{preview.description || 'Sem descrição.'}</p></div>
    </div>
    <form onSubmit={submit} onChange={e => refresh(e.currentTarget)}>
      <div className="avatar-upload"><label className="secondary">Ícone imagem/GIF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { if (f.size > 8 * 1024 * 1024) { toast.error('O limite é 8 MB.'); return } setIcon({ file: f }) } e.target.value = '' }} /></label>
        <button type="button" className="secondary" onClick={() => setGifFor(true)}><Search size={14} />Buscar GIF</button>
        {iconPreview && <button type="button" className="secondary danger-text" onClick={() => setIcon({ removed: true })}>Remover ícone</button>}
      </div>
      <label>Nome do servidor<input name="name" defaultValue={server.name} required minLength={2} maxLength={60} /></label>
      <label>Descrição<textarea name="description" defaultValue={server.description} maxLength={240} rows={2} placeholder="Sobre o que é este espaço?" /></label>
      <div className="name-style-row">
        <label className="check-inline"><input type="checkbox" name="use_color" defaultChecked={Boolean(server.name_color)} />Cor</label>
        <input name="color" type="color" defaultValue={server.name_color || '#b69afb'} aria-label="Cor do nome do servidor" />
        <label className="grow">Efeito<select name="effect" defaultValue={server.name_effect || 'none'}>{NAME_EFFECTS.map(fx => <option key={fx.value} value={fx.value}>{fx.label}</option>)}</select></label>
        <label className="grow">Fonte<select name="font" defaultValue={server.name_font || 'default'}>{NAME_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
      </div>
      <button className="primary full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar servidor'}</button>
    </form>
    {gifFor && <Modal title="GIF para o ícone" close={() => setGifFor(false)}>
      <div className="gif-panel inline"><GifPanel onGif={url => { setIcon({ external: url }); setGifFor(false) }} /></div>
    </Modal>}
  </Modal>
}
export function Invite({ serverId, serverName, close }: { serverId: string; serverName: string; close: () => void }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  async function generate() {
    setBusy(true)
    try {
      const id = await rpc<string>('ddtal_create_invite', { p_server: serverId })
      setLink(`${location.origin}/?invite=${id}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Modal title="A comunidade começa com um convite." close={close}><p className="muted">Traga seus alunos e amigos para <strong>{serverName}</strong>. Eles poderão entrar com e-mail ou Google.</p><div className="invite-art"><Link size={40} /></div>{link ? <><label>Seu link de convite<input value={link} readOnly onFocus={e => e.target.select()} /></label><button className="primary full" onClick={() => void navigator.clipboard.writeText(link).then(() => { setCopied(true); toast.success('Convite copiado!') }).catch(() => toast.error('Selecione e copie o link acima.'))}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'Link copiado' : 'Copiar convite'}</button><p className="modal-footnote">Válido por 7 dias, para até 100 novos participantes.</p></> : <button className="primary full" disabled={busy} onClick={generate}>{busy ? 'Preparando…' : 'Gerar link de convite'}</button>}</Modal>
}
const NAME_EFFECTS: { value: NonNullable<Profile['name_effect']>; label: string }[] = [
  { value: 'none', label: 'Nenhum' }, { value: 'glow', label: 'Brilho' }, { value: 'pulse', label: 'Pulso' },
  { value: 'rainbow', label: 'Arco-íris' }, { value: 'wave', label: 'Onda' },
]
const NAME_FONTS: { value: NonNullable<Profile['name_font']>; label: string }[] = [
  { value: 'default', label: 'Padrão' }, { value: 'mono', label: 'Terminal' },
  { value: 'pixel', label: 'Pixel' }, { value: 'script', label: 'Escrita à mão' },
]
const AVATAR_FRAMES: { value: NonNullable<Profile['avatar_frame']>; label: string }[] = [
  { value: 'none', label: 'Nenhuma' }, { value: 'ring', label: 'Anel' }, { value: 'glow', label: 'Brilho' },
  { value: 'rainbow', label: 'Arco-íris' }, { value: 'cyber', label: 'Cyber' }, { value: 'dashed', label: 'Tracejado' }, { value: 'gold', label: 'Ouro' },
]
const CARD_EFFECTS: { value: NonNullable<Profile['card_effect']>; label: string }[] = [
  { value: 'none', label: 'Nenhum' }, { value: 'scanlines', label: 'Scanlines' }, { value: 'grid', label: 'Grade' },
  { value: 'aurora', label: 'Aurora' }, { value: 'matrix', label: 'Matrix' }, { value: 'vapor', label: 'Vaporwave' },
]
type PendingMedia = { file?: File; external?: string; removed?: boolean }
function mediaPreview(pending: PendingMedia, stored: string | null | undefined): string | null {
  if (pending.file) return URL.createObjectURL(pending.file)
  if (pending.external) return pending.external
  if (pending.removed) return null
  return stored ? (stored.startsWith('http') ? stored : avatarUrl(stored)) : null
}
// Uploads a picked file as-is when animated (GIF); other images are cropped/resized.
async function uploadMedia(profileId: string, kind: 'avatar' | 'banner', file: File): Promise<string> {
  if (file.type === 'image/gif') {
    const path = `${profileId}/${kind}.gif`
    const { error } = await db().storage.from('ddtal-avatars').upload(path, file, { upsert: true, contentType: 'image/gif' })
    if (error) throw error
    return path
  }
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const w = kind === 'avatar' ? 256 : Math.min(960, bitmap.width)
  const h = kind === 'avatar' ? 256 : Math.round(w * bitmap.height / bitmap.width)
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  if (kind === 'avatar') {
    const side = Math.min(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, w, h)
  } else ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Não consegui processar a imagem.')), 'image/webp', 0.88))
  const path = `${profileId}/${kind}.webp`
  const { error } = await db().storage.from('ddtal-avatars').upload(path, blob, { upsert: true, contentType: 'image/webp' })
  if (error) throw error
  return path
}
export function ProfileSettings({ profile, close, updated }: { profile: Profile; close: () => void; updated: (profile: Profile) => void }) {
  const [tab, setTab] = useState<'perfil' | 'voz'>('perfil')
  const [busy, setBusy] = useState(false)
  const [avatar, setAvatar] = useState<PendingMedia>({})
  const [banner, setBanner] = useState<PendingMedia>({})
  const [gifFor, setGifFor] = useState<'avatar' | 'banner' | null>(null)
  const [preview, setPreview] = useState<Profile>({ ...profile })
  function pickFile(kind: 'avatar' | 'banner', file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Escolha uma imagem ou GIF.')
    if (file.size > 8 * 1024 * 1024) { toast.error('O limite é 8 MB.'); return }
    if (kind === 'avatar') setAvatar({ file }); else setBanner({ file })
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const values = new FormData(e.currentTarget); setBusy(true)
    try {
      const resolve = async (pending: PendingMedia, kind: 'avatar' | 'banner', stored?: string | null) =>
        pending.file ? uploadMedia(profile.id, kind, pending.file)
          : pending.external ? pending.external
          : pending.removed ? null : stored
      const { data, error } = await db().from('ddtal_profiles').update({
        display_name: values.get('name'), handle: String(values.get('handle')).toLowerCase(),
        status_text: values.get('status'), bio: values.get('bio'),
        avatar_url: await resolve(avatar, 'avatar', preview.avatar_url),
        banner_url: await resolve(banner, 'banner', preview.banner_url),
        name_color: values.get('use_color') === 'on' ? values.get('color') : null,
        name_effect: values.get('effect'), name_font: values.get('font'),
        avatar_frame: values.get('frame'), card_effect: values.get('card_effect'),
        card_color: values.get('use_card_color') === 'on' ? values.get('card_color') : null,
      }).eq('id', profile.id).select().single()
      if (error) throw error
      updated(data as Profile); toast.success('Perfil atualizado.'); close()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const refresh = (form: HTMLFormElement) => {
    const v = new FormData(form)
    setPreview({ ...preview, display_name: String(v.get('name')) || 'Builder', status_text: String(v.get('status') || ''), bio: String(v.get('bio') || ''), name_color: v.get('use_color') === 'on' ? String(v.get('color')) : null, name_effect: v.get('effect') as Profile['name_effect'], name_font: v.get('font') as Profile['name_font'], avatar_frame: v.get('frame') as Profile['avatar_frame'], card_effect: v.get('card_effect') as Profile['card_effect'], card_color: v.get('use_card_color') === 'on' ? String(v.get('card_color')) : null })
  }
  const previewCard = { ...preview, avatar_url: mediaPreview(avatar, preview.avatar_url), banner_url: mediaPreview(banner, preview.banner_url) }
  return <Modal title="Como a comunidade vê você." close={close}>
    <div className="settings-tabs"><button className={tab === 'perfil' ? 'active' : ''} onClick={() => setTab('perfil')}><UserRound size={15} />Perfil</button><button className={tab === 'voz' ? 'active' : ''} onClick={() => setTab('voz')}><Mic size={15} />Voz e áudio</button></div>
    {tab === 'voz' ? <VoiceSettings /> : <>
    <ProfileCard profile={previewCard} />
    <form onSubmit={submit} onChange={e => refresh(e.currentTarget)}>
      <div className="name-style-row">
        <label className="grow">Avatar<div className="avatar-upload"><label className="secondary">Imagem/GIF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { pickFile('avatar', e.target.files?.[0]); e.target.value = '' }} /></label>
          <button type="button" className="secondary" onClick={() => setGifFor('avatar')}><Search size={14} />Buscar GIF</button>
          {previewCard.avatar_url && <button type="button" className="secondary danger-text" onClick={() => setAvatar({ removed: true })}>Remover</button>}</div></label>
        <label className="grow">Capa do perfil<div className="avatar-upload"><label className="secondary">Imagem/GIF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { pickFile('banner', e.target.files?.[0]); e.target.value = '' }} /></label>
          <button type="button" className="secondary" onClick={() => setGifFor('banner')}><Search size={14} />Buscar GIF</button>
          {previewCard.banner_url && <button type="button" className="secondary danger-text" onClick={() => setBanner({ removed: true })}>Remover</button>}</div></label>
      </div>
      <label>Nome de exibição<input name="name" defaultValue={profile.display_name} required minLength={2} maxLength={60} /></label>
      <label>Seu identificador<input name="handle" defaultValue={profile.handle} required minLength={3} maxLength={32} pattern="[a-z0-9_]{3,32}" /></label>
      <label>Status<input name="status" defaultValue={profile.status_text} maxLength={120} placeholder="Ex.: Não confio em pessoas. Confio em padrões." /></label>
      <label>Sobre mim<textarea name="bio" defaultValue={profile.bio} maxLength={500} rows={3} placeholder="Anote o que quiser compartilhar com a turma…" /></label>
      <div className="name-style-row">
        <label className="check-inline"><input type="checkbox" name="use_color" defaultChecked={Boolean(profile.name_color)} />Cor</label>
        <input name="color" type="color" defaultValue={profile.name_color || '#b69afb'} aria-label="Cor do nome" />
        <label className="grow">Efeito<select name="effect" defaultValue={profile.name_effect || 'none'}>{NAME_EFFECTS.map(fx => <option key={fx.value} value={fx.value}>{fx.label}</option>)}</select></label>
        <label className="grow">Fonte<select name="font" defaultValue={profile.name_font || 'default'}>{NAME_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
      </div>
      <div className="name-style-row">
        <label className="grow">Moldura do avatar<select name="frame" defaultValue={profile.avatar_frame || 'none'}>{AVATAR_FRAMES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
        <label className="grow">Efeito do cartão<select name="card_effect" defaultValue={profile.card_effect || 'none'}>{CARD_EFFECTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
        <label className="check-inline"><input type="checkbox" name="use_card_color" defaultChecked={Boolean(profile.card_color)} />Cor</label>
        <input name="card_color" type="color" defaultValue={profile.card_color || '#7c5cff'} aria-label="Cor do cartão" />
      </div>
      <button className="primary full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar perfil'}</button>
    </form>
    </>}
    {gifFor && <Modal title={gifFor === 'avatar' ? 'GIF para o avatar' : 'GIF para a capa'} close={() => setGifFor(null)}>
      <div className="gif-panel inline"><GifPanel onGif={url => { (gifFor === 'avatar' ? setAvatar : setBanner)({ external: url }); setGifFor(null) }} /></div>
    </Modal>}
  </Modal>
}
const ROLE_FLAGS: { flag: RoleFlag; label: string; hint: string }[] = [
  { flag: 'moderate_voice', label: 'Moderar voz', hint: 'Silenciar, expulsar e mover pessoas nas salas' },
  { flag: 'manage_channels', label: 'Gerenciar canais', hint: 'Criar canais de texto e voz' },
  { flag: 'manage_roles', label: 'Gerenciar cargos', hint: 'Criar e atribuir cargos' },
  { flag: 'manage_invites', label: 'Gerenciar convites', hint: 'Gerar e revogar links de convite' },
  { flag: 'kick_members', label: 'Expulsar membros', hint: 'Remover pessoas do servidor' },
  { flag: 'manage_nicknames', label: 'Gerenciar apelidos', hint: 'Alterar o apelido de outros membros' },
  { flag: 'edit_notes', label: 'Editar notas', hint: 'Escrever nas notas compartilhadas' },
]
const roleFlags = (role: Partial<Role>, form?: HTMLFormElement) => Object.fromEntries(ROLE_FLAGS.map(({ flag }) =>
  [flag, form ? Boolean((form.elements.namedItem(`perm_${flag}`) as HTMLInputElement)?.checked) : Boolean(role[flag])])) as Record<RoleFlag, boolean>

export function ManageRoles({ serverId, roles, close, changed }: { serverId: string; roles: Role[]; close: () => void; changed: () => void }) {
  const [busy, setBusy] = useState(false)
  const sorted = [...roles].sort((a, b) => a.position - b.position)
  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn(); changed() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const values = new FormData(form)
    await run(async () => {
      await rpc('ddtal_create_role', { p_server: serverId, p_name: values.get('name'), p_color: values.get('color'), p_flags: roleFlags({}, form) })
      form.reset(); toast.success('Cargo criado.')
    })
  }
  const update = (role: Role) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget; const values = new FormData(form)
    void run(async () => { await rpc('ddtal_update_role', { p_role: role.id, p_name: values.get('name'), p_color: values.get('color'), p_flags: roleFlags({}, form) }); toast.success('Cargo atualizado.') })
  }
  return <Modal title="Cargos e permissões." close={close}><p className="muted">Cargos organizam sua comunidade e liberam permissões. Donos e moderadores já têm todos os poderes.</p>
    {sorted.length > 0 && <div className="roles-list">{sorted.map((role, i) => <details className="role-item" key={role.id}>
      <summary><i className="role-dot" style={{ background: role.color }} />{role.name}<span className="role-summary-actions">
        <button aria-label="Subir cargo" title="Subir cargo" disabled={busy || i === 0} onClick={e => { e.preventDefault(); void run(() => rpc('ddtal_move_role', { p_role: role.id, p_dir: -1 })) }}><ArrowUp size={14} /></button>
        <button aria-label="Descer cargo" title="Descer cargo" disabled={busy || i === sorted.length - 1} onClick={e => { e.preventDefault(); void run(() => rpc('ddtal_move_role', { p_role: role.id, p_dir: 1 })) }}><ArrowDown size={14} /></button>
        <button aria-label="Excluir cargo" title="Excluir cargo" disabled={busy} onClick={e => { e.preventDefault(); void run(() => rpc('ddtal_delete_role', { p_role: role.id })) }}><Trash2 size={14} /></button></span></summary>
      <form className="role-form" onSubmit={update(role)}>
        <div className="role-fields"><label>Nome<input name="name" defaultValue={role.name} required maxLength={40} /></label><label>Cor<input name="color" type="color" defaultValue={role.color} /></label></div>
        <div className="perm-grid">{ROLE_FLAGS.map(({ flag, label, hint }) => <label key={flag} className="perm-check" title={hint}><input type="checkbox" name={`perm_${flag}`} defaultChecked={role[flag]} /><span>{label}</span></label>)}</div>
        <button className="secondary full" disabled={busy}>Salvar cargo</button>
      </form>
    </details>)}</div>}
    <form className="role-form role-create" onSubmit={create}>
      <strong>Novo cargo</strong>
      <div className="role-fields"><label>Nome<input name="name" required maxLength={40} placeholder="Ex.: Mr Robot" /></label><label>Cor<input name="color" type="color" defaultValue="#b69afb" /></label></div>
      <div className="perm-grid">{ROLE_FLAGS.map(({ flag, label, hint }) => <label key={flag} className="perm-check" title={hint}><input type="checkbox" name={`perm_${flag}`} /><span>{label}</span></label>)}</div>
      <button className="primary full" disabled={busy}><Plus size={17} />{busy ? 'Salvando…' : 'Criar cargo'}</button>
    </form>
    <p className="modal-footnote">Para atribuir um cargo a alguém, abra o menu do membro no painel “Pessoas”.</p>
  </Modal>
}
export function SearchMessages({ channel, close }: { channel: Channel; close: () => void }) {
  const [results, setResults] = useState<Message[]>([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const values = new FormData(e.currentTarget); setBusy(true)
    const term = String(values.get('term')).replace(/[\\%_]/g, '\\$&')
    try {
      const { data, error } = await db().from('ddtal_messages').select('*,author:ddtal_profiles!author_id(*)').eq('channel_id', channel.id).ilike('content', `%${term}%`).order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      setResults(data as Message[]); setSearched(true)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Modal title={`Buscar em ${channel.name}`} close={close}><form className="search-form" onSubmit={submit}><input name="term" aria-label="Buscar mensagens" placeholder="O que você está procurando?" required minLength={2} maxLength={100} autoFocus /><button className="primary" disabled={busy} aria-label="Buscar"><Search size={18} /></button></form><div className="search-results">{results.map(m => <article key={m.id}><strong>{m.author?.display_name}</strong><time>{new Date(m.created_at).toLocaleString('pt-BR')}</time><p>{m.content}</p></article>)}{searched && !results.length && <p className="muted">Nenhuma mensagem encontrada.</p>}</div><p className="modal-footnote">Até 30 mensagens mais recentes por busca.</p></Modal>
}
