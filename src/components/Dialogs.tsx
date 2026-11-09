import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Link, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { db, errorMessage, rpc, avatarUrl } from '../lib/supabase'
import type { Channel, Message, Profile, Role, RoleFlag } from '../lib/types'
import { Avatar, Modal, StyledName } from './ui'

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
async function makeAvatarBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const side = Math.min(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Não consegui processar a imagem.')), 'image/webp', 0.9))
}
export function ProfileSettings({ profile, close, updated }: { profile: Profile; close: () => void; updated: (profile: Profile) => void }) {
  const [busy, setBusy] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Profile>({ ...profile })
  const draftAvatar = avatarFile ? URL.createObjectURL(avatarFile) : avatarUrl(preview.avatar_url)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const values = new FormData(form); setBusy(true)
    try {
      let avatar_url: string | null | undefined = preview.avatar_url
      if (avatarFile) {
        const blob = await makeAvatarBlob(avatarFile)
        avatar_url = `${profile.id}/avatar.webp`
        const { error: uploadError } = await db().storage.from('ddtal-avatars').upload(avatar_url, blob, { upsert: true, contentType: 'image/webp' })
        if (uploadError) throw uploadError
      }
      if (values.get('remove_avatar') === 'on') avatar_url = null
      const { data, error } = await db().from('ddtal_profiles').update({
        display_name: values.get('name'), handle: String(values.get('handle')).toLowerCase(),
        avatar_url, name_color: values.get('use_color') === 'on' ? values.get('color') : null,
        name_effect: values.get('effect'), name_font: values.get('font'),
      }).eq('id', profile.id).select().single()
      if (error) throw error
      updated(data as Profile); toast.success('Perfil atualizado.'); close()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const refresh = (form: HTMLFormElement) => {
    const v = new FormData(form)
    setPreview({ ...preview, display_name: String(v.get('name')) || 'Builder', name_color: v.get('use_color') === 'on' ? String(v.get('color')) : null, name_effect: v.get('effect') as Profile['name_effect'], name_font: v.get('font') as Profile['name_font'] })
  }
  return <Modal title="Como a comunidade vê você." close={close}>
    <div className="profile-preview"><Avatar name={preview.display_name} url={draftAvatar} /><div><StyledName profile={preview} className="preview-name" /><span>@{preview.handle}</span></div></div>
    <form onSubmit={submit} onChange={e => refresh(e.currentTarget)}>
      <div className="avatar-upload"><label className="secondary">Escolher imagem<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { if (f.size > 5 * 1024 * 1024) { toast.error('Imagem acima de 5 MB.'); return } setAvatarFile(f) } }} /></label>
        {preview.avatar_url && <label className="check-inline"><input type="checkbox" name="remove_avatar" /> Remover avatar</label>}
        <span className="muted">Recortamos e centralizamos em 256×256.</span></div>
      <label>Nome de exibição<input name="name" defaultValue={profile.display_name} required minLength={2} maxLength={60} /></label>
      <label>Seu identificador<input name="handle" defaultValue={profile.handle} required minLength={3} maxLength={32} pattern="[a-z0-9_]{3,32}" /></label>
      <p className="muted">Use letras minúsculas, números e _. Seus amigos encontram você por esse identificador.</p>
      <div className="name-style-row">
        <label className="check-inline"><input type="checkbox" name="use_color" defaultChecked={Boolean(profile.name_color)} />Cor</label>
        <input name="color" type="color" defaultValue={profile.name_color || '#b69afb'} aria-label="Cor do nome" />
        <label className="grow">Efeito<select name="effect" defaultValue={profile.name_effect || 'none'}>{NAME_EFFECTS.map(fx => <option key={fx.value} value={fx.value}>{fx.label}</option>)}</select></label>
        <label className="grow">Fonte<select name="font" defaultValue={profile.name_font || 'default'}>{NAME_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
      </div>
      <button className="primary full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar perfil'}</button>
    </form></Modal>
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
