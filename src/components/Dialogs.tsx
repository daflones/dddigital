import { useState } from 'react'
import { Check, Copy, Link, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { db, errorMessage, rpc } from '../lib/supabase'
import type { Channel, Message, Profile } from '../lib/types'
import { Modal } from './ui'

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
export function ProfileSettings({ profile, close, updated }: { profile: Profile; close: () => void; updated: (profile: Profile) => void }) {
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const values = new FormData(e.currentTarget); setBusy(true)
    try {
      const { data, error } = await db().from('ddtal_profiles').update({ display_name: values.get('name'), handle: String(values.get('handle')).toLowerCase() }).eq('id', profile.id).select().single()
      if (error) throw error
      updated(data as Profile); toast.success('Perfil atualizado.'); close()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Modal title="Como a comunidade vê você." close={close}><form onSubmit={submit}><label>Nome de exibição<input name="name" defaultValue={profile.display_name} required minLength={2} maxLength={60} /></label><label>Seu identificador<input name="handle" defaultValue={profile.handle} required minLength={3} maxLength={32} pattern="[a-z0-9_]{3,32}" /></label><p className="muted">Use letras minúsculas, números e _. Seus amigos encontram você por esse identificador.</p><button className="primary full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar perfil'}</button></form></Modal>
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
