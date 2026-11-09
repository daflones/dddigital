import { useEffect, useRef, useState } from 'react'
import { CornerUpLeft, FileText, ImagePlus, Mic, Pencil, Send, Smile, Square, Trash2, X, MessageSquare, ArrowDown, LoaderCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { db, errorMessage } from '../lib/supabase'
import type { Channel, Message, Profile } from '../lib/types'
import { demoMessages } from '../lib/demo'
import { Avatar, Modal, ProfileCard, StyledName } from './ui'
import { EmojiGifPicker } from './Pickers'

const PAGE = 50
const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav']
const messageSelect = '*,author:ddtal_profiles!author_id(*)'
const replySelect = 'id,content,attachment_name,author:ddtal_profiles!author_id(*)'

// PostgREST resolves self-joins as to-many; fetch reply targets in a second
// query instead. Missing parents render as "Mensagem removida".
async function hydrateReplies(rows: Message[]) {
  const ids = [...new Set(rows.map(m => m.reply_to).filter((id): id is string => Boolean(id)))]
  if (!ids.length) return rows
  const { data } = await db().from('ddtal_messages').select(replySelect).in('id', ids)
  const byId = new Map(((data || []) as unknown as NonNullable<Message['reply']>[]).map(r => [r!.id, r]))
  for (const m of rows) if (m.reply_to) m.reply = byId.get(m.reply_to) ?? { id: m.reply_to, content: '', author: null }
  return rows
}

function Attachment({ message }: { message: Message }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    async function refresh() {
      const { data, error } = await db().storage.from('ddtal-attachments').createSignedUrl(message.attachment_path!, 3600)
      if (alive) { setUrl(data?.signedUrl || ''); setFailed(Boolean(error)) }
    }
    void refresh()
    const interval = setInterval(() => void refresh(), 50 * 60 * 1000)
    return () => { alive = false; clearInterval(interval) }
  }, [message.attachment_path])
  if (!url) return <span className="muted">{failed ? 'Arquivo indisponível.' : 'Carregando arquivo…'}</span>
  if (message.attachment_type?.startsWith('audio/'))
    return <audio className="attachment-audio" controls preload="metadata" src={url} />
  return <a className="attachment" href={url} target="_blank" rel="noopener noreferrer">
    {message.attachment_type?.startsWith('image/') ? <img src={url} alt={message.attachment_name || 'Imagem compartilhada'} loading="lazy" /> : <span><FileText size={22} />{message.attachment_name}<ArrowDown size={16} /></span>}
  </a>
}

function ReplyQuote({ reply }: { reply: NonNullable<Message['reply']> }) {
  const name = reply.author?.display_name
  return <div className={`reply-quote ${name ? '' : 'deleted'}`}>
    {name && <Avatar name={name} url={reply.author?.avatar_url} size="tiny" />}
    <strong>{name || 'Builder'}</strong>
    <span>{reply.content || (reply.attachment_name ? `Arquivo: ${reply.attachment_name}` : 'Mensagem removida')}</span>
  </div>
}

export function Chat({ channel, profile, demo, compact = false, canDeleteOthers = false }: {
  channel: Channel; profile: Profile; demo: boolean; compact?: boolean; canDeleteOthers?: boolean
}) {
  const [messages, setMessages] = useState<Message[]>(demo ? demoMessages.filter(m => m.channel_id === channel.id) : [])
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(!demo)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState(false)
  const [replying, setReplying] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Profile | null>(null)
  const [recording, setRecording] = useState(false)
  const cancelled = useRef(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const nearBottom = useRef(true)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; recorder.current?.stop() } }, [])

  useEffect(() => {
    if (demo) return
    let alive = true
    async function load() {
      const { data, error } = await db().from('ddtal_messages').select(messageSelect)
        .eq('channel_id', channel.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE)
      if (!alive) return
      if (error) setError(error.message)
      else {
        setError('')
        const rows = await hydrateReplies(data as Message[])
        if (!alive) return
        setMessages(current => {
          const byId = new Map(current.map(m => [m.id, m]))
          for (const m of rows) byId.set(m.id, m)
          return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        })
        setHasMore(data.length === PAGE)
      }
      setLoading(false)
    }
    const subscription = db().channel(`ddtal-chat-${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ddtal_messages', filter: `channel_id=eq.${channel.id}` }, () => void load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ddtal_messages', filter: `channel_id=eq.${channel.id}` }, () => void load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ddtal_messages', filter: `channel_id=eq.${channel.id}` }, payload => setMessages(current => current.filter(m => m.id !== (payload.old as { id: string }).id)))
      .subscribe(status => { if (status === 'SUBSCRIBED') void load() })
    void load()
    return () => { alive = false; void db().removeChannel(subscription) }
  }, [channel.id, demo])
  useEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [messages, loading])

  async function older() {
    if (demo || !messages[0]) return
    setLoading(true)
    const first = messages[0]
    const { data, error } = await db().from('ddtal_messages').select(messageSelect)
      .eq('channel_id', channel.id)
      .or(`created_at.lt.${first.created_at},and(created_at.eq.${first.created_at},id.lt.${first.id})`)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE)
    if (error) toast.error(error.message)
    else { nearBottom.current = false; const rows = await hydrateReplies(data as Message[]); setMessages(current => [...rows.reverse(), ...current]); setHasMore(rows.length === PAGE) }
    setLoading(false)
  }
  function chooseFile(next?: File) {
    if (!next) return
    if (!allowedTypes.includes(next.type)) return toast.error('Envie PNG, JPG, WebP, GIF, PDF, TXT ou áudio.')
    if (next.size > 20 * 1024 * 1024) return toast.error('O limite por arquivo é 20 MB.')
    setFile(next)
  }
  // GIFs are sent as inline markdown images (no storage needed, plays animated).
  function sendGif(url: string) {
    setPicker(false)
    if (demo) return toast.info('Entre na sua conta para enviar GIFs.')
    setContent(v => v ? v + ` ![gif](${url})` : `![gif](${url})`)
    textArea.current?.focus()
  }
  async function toggleRecording() {
    if (recording) { recorder.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks: Blob[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        if (!cancelled.current) {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
          if (blob.size > 500) {
            const ext = (rec.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : rec.mimeType?.includes('mp4') ? 'm4a' : 'webm'
            setFile(new File([blob], `audio-${Date.now()}.${ext}`, { type: rec.mimeType || 'audio/webm' }))
          }
        }
        cancelled.current = false
      }
      recorder.current = rec
      rec.start()
      setRecording(true)
      toast.info('Gravando áudio… clique de novo para parar.')
    } catch { toast.error('Não consegui acessar o microfone.') }
  }
  function cancelRecording() {
    cancelled.current = true
    recorder.current?.stop()
    setRecording(false)
  }
  function cancelComposer() {
    cancelled.current = true
    setContent(''); setFile(null); setReplying(null); setEditing(null); setPicker(false)
    if (recording) cancelRecording()
  }
  async function send(event: React.FormEvent) {
    event.preventDefault()
    if ((!content.trim() && !file) || sending || recording) return
    if (demo && file) return toast.info('Entre na sua conta para compartilhar arquivos.')
    const id = crypto.randomUUID()
    const text = content.trim()
    setSending(true)
    cancelled.current = false
    let path: string | null = null
    try {
      if (file) {
        path = `${channel.id}/${profile.id}/${id}`
        const { error } = await db().storage.from('ddtal-attachments').upload(path, file, { contentType: file.type, upsert: false })
        if (error) throw error
        if (cancelled.current) { await db().storage.from('ddtal-attachments').remove([path]); path = null; return }
      }
      const payload = { id, channel_id: channel.id, author_id: profile.id, content: text, attachment_path: path, attachment_name: file?.name || null, attachment_type: file?.type || null, reply_to: replying?.id || null }
      let created: Message
      if (demo) created = { ...payload, created_at: new Date().toISOString(), author: profile, reply: replying ? { id: replying.id, content: replying.content, attachment_name: replying.attachment_name, author: replying.author } : null }
      else {
        const { data, error } = await db().from('ddtal_messages').insert(payload).select(messageSelect).single()
        if (error) throw error
        created = { ...(data as Message), reply: replying ? { id: replying.id, content: replying.content, attachment_name: replying.attachment_name, author: replying.author } : null }
      }
      if (mounted.current) {
        nearBottom.current = true
        setMessages(current => current.some(m => m.id === id) ? current : [...current, created])
        setContent(''); setFile(null); setReplying(null)
      }
    } catch (e) {
      // Preserve uploaded files on ambiguous network failures: the insert may have committed.
      toast.error(errorMessage(e))
    } finally { if (mounted.current) setSending(false) }
  }
  async function saveEdit() {
    if (!editing || !editDraft.trim()) return
    const body = editDraft.trim()
    try {
      const edited_at = new Date().toISOString()
      const { error } = await db().from('ddtal_messages').update({ content: body, edited_at }).eq('id', editing.id)
      if (error) throw error
      setMessages(current => current.map(m => m.id === editing.id ? { ...m, content: body, edited_at } : m))
      setEditing(null)
    } catch (e) { toast.error(errorMessage(e)) }
  }
  async function remove(message: Message) {
    setConfirmDelete(null)
    if (demo) { setMessages(current => current.filter(m => m.id !== message.id)); return }
    try {
      const { error } = await db().from('ddtal_messages').delete().eq('id', message.id)
      if (error) throw error
      setMessages(current => current.filter(m => m.id !== message.id))
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const actionable = (m: Message) => m.author_id === profile.id || canDeleteOthers
  return <section className={`chat ${compact ? 'compact' : ''}`} aria-label="Conversa do canal">
    <div className="messages" ref={scroll} onScroll={() => { const el = scroll.current!; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }}>
      {hasMore && <button className="text-button older" disabled={loading} onClick={older}>Carregar mensagens anteriores</button>}
      {!compact && <div className="channel-welcome"><div><MessageSquare size={28} /></div><h2>Esse é o começo de #{channel.name}</h2><p>{channel.topic}</p></div>}
      <div className="date-divider"><span>{demo ? 'CONVERSA DE EXEMPLO' : 'CONVERSA DO CANAL'}</span></div>
      {loading && messages.length === 0 && <div className="center-muted"><LoaderCircle className="spin" size={20} /> Carregando conversa…</div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!loading && !error && messages.length === 0 && <div className="empty-chat"><MessagesIcon /><p>Uma boa conversa começa com um olá.</p><span>Envie a primeira mensagem.</span></div>}
      {messages.map((message, index) => {
        const previous = messages[index - 1]
        const grouped = previous?.author_id === message.author_id && !previous.reply_to && !message.reply_to && new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 300000
        return <article className={`message ${grouped ? 'grouped' : ''}`} key={message.id}>
          {!grouped && <button className="author-click" aria-label={`Ver perfil de ${message.author?.display_name || 'Builder'}`} onClick={() => message.author && setViewing(message.author)}><Avatar name={message.author?.display_name || 'Builder'} url={message.author?.avatar_url} size="small" frame={message.author?.avatar_frame} /></button>}
          <div className="message-body">
            {!grouped && <div className="message-meta"><button className="author-click name" onClick={() => message.author && setViewing(message.author)}><strong>{message.author ? <StyledName profile={message.author} /> : 'Builder'}</strong></button>{message.author_id === profile.id && <span className="you-tag">você</span>}<time title={new Date(message.created_at).toLocaleString('pt-BR')}>{new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div>}
            {message.reply && <ReplyQuote reply={message.reply} />}
            {editing?.id === message.id ? <div className="edit-box">
              <textarea value={editDraft} maxLength={6000} autoFocus rows={2} onChange={e => setEditDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit() } if (e.key === 'Escape') setEditing(null) }} />
              <span className="edit-hint">Enter para salvar · Esc para cancelar</span>
            </div> : message.content && <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
              img: ({ alt, src }) => typeof src === 'string' && /^https:\/\//.test(src) ? <img className="md-image" src={src} alt={alt || 'imagem'} loading="lazy" /> : <span>[Imagem externa: {alt || 'link'}]</span>,
            }}>{message.content}</ReactMarkdown>{message.edited_at && <span className="edited-tag">(editado)</span>}</div>}
            {message.attachment_path && <Attachment message={message} />}
          </div>
          {actionable(message) && <div className="message-actions">
            <button title="Responder" aria-label="Responder mensagem" onClick={() => { setReplying(message); setEditing(null); textArea.current?.focus() }}><CornerUpLeft size={15} /></button>
            {message.author_id === profile.id && message.content && <button title="Editar" aria-label="Editar mensagem" onClick={() => { setEditing(message); setEditDraft(message.content); setReplying(null) }}><Pencil size={14} /></button>}
            {confirmDelete === message.id
              ? <button className="danger-confirm" title="Confirmar exclusão" aria-label="Confirmar exclusão" onClick={() => void remove(message)}>Apagar?</button>
              : <button title="Apagar mensagem" aria-label="Apagar mensagem" onClick={() => { setConfirmDelete(message.id); setTimeout(() => setConfirmDelete(c => c === message.id ? null : c), 3200) }}><Trash2 size={14} /></button>}
          </div>}
        </article>
      })}
    </div>
    <form className="composer-area" onSubmit={send}>
      {replying && <div className="composer-banner"><CornerUpLeft size={14} /><span>Respondendo a <strong>{replying.author?.display_name || 'Builder'}</strong>: {replying.content?.slice(0, 80) || replying.attachment_name || 'mensagem'}</span><button type="button" className="icon-button" aria-label="Cancelar resposta" onClick={() => setReplying(null)}><X size={15} /></button></div>}
      {file && <div className="file-preview"><FileText size={16} /><span>{file.name}</span><button type="button" className="icon-button" aria-label="Remover arquivo" onClick={() => setFile(null)}><X size={16} /></button></div>}
      {recording && <div className="recording-banner"><i className="rec-dot" /><span>Gravando áudio…</span><button type="button" className="text-button" onClick={cancelRecording}>Cancelar</button><button type="button" className="icon-button" aria-label="Parar gravação" onClick={() => recorder.current?.stop()}><Square size={14} /></button></div>}
      <div className="composer">
        <textarea ref={textArea} aria-label="Mensagem" placeholder={compact ? 'Faça parte da conversa…' : `Conversar em #${channel.name}`} value={content} maxLength={6000} disabled={sending} rows={compact ? 2 : 1} onChange={e => setContent(e.target.value)}
          onPaste={e => { const image = [...e.clipboardData.files].find(f => f.type.startsWith('image/')); if (image) { e.preventDefault(); chooseFile(image) } }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit() }
            if (e.key === 'Escape') cancelComposer()
          }} />
        <div className="composer-actions"><div>
          <button className="icon-button" type="button" title="Enviar imagem, arquivo ou áudio" aria-label="Enviar imagem ou arquivo" disabled={sending} onClick={() => input.current?.click()}><ImagePlus size={19} /></button>
          <button className={`icon-button ${picker ? 'active' : ''}`} type="button" title="Emojis e GIFs" aria-label="Emojis e GIFs" disabled={sending} onClick={() => setPicker(!picker)}><Smile size={19} /></button>
          <button className={`icon-button ${recording ? 'recording' : ''}`} type="button" title={recording ? 'Parar e usar áudio' : 'Gravar áudio'} aria-label={recording ? 'Parar gravação' : 'Gravar áudio'} disabled={sending} onClick={() => void toggleRecording()}><Mic size={19} /></button>
        </div>{sending
          ? <button type="button" className="send-button cancel" aria-label="Cancelar envio" onClick={cancelComposer}><X size={17} /></button>
          : <button className="send-button" aria-label="Enviar mensagem" disabled={!content.trim() && !file}><Send size={17} /></button>}</div>
      </div>
      <input ref={input} type="file" hidden accept={allowedTypes.join(',')} onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = '' }} />
      <span className="composer-hint">{demo ? 'Prévia interativa · mensagens não são publicadas' : 'Enter envia · Esc limpa · 🎙 grava áudio'}</span>
      {picker && <EmojiGifPicker onEmoji={u => { setContent(v => v + u); textArea.current?.focus() }} onGif={sendGif} close={() => setPicker(false)} />}
      {viewing && <Modal title="Perfil" close={() => setViewing(null)}><ProfileCard profile={viewing} /></Modal>}
    </form>
  </section>
}
function MessagesIcon() { return <MessageSquare size={26} /> }
