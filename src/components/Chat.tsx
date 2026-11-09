import { useEffect, useRef, useState } from 'react'
import { FileText, ImagePlus, Send, Smile, X, MessageSquare, ArrowDown, LoaderCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { db, errorMessage } from '../lib/supabase'
import type { Channel, Message, Profile } from '../lib/types'
import { demoMessages } from '../lib/demo'
import { Avatar } from './ui'

const PAGE = 50
const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']

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
  return <a className="attachment" href={url} target="_blank" rel="noopener noreferrer">
    {message.attachment_type?.startsWith('image/') ? <img src={url} alt={message.attachment_name || 'Imagem compartilhada'} loading="lazy" /> : <span><FileText size={22} />{message.attachment_name}<ArrowDown size={16} /></span>}
  </a>
}

export function Chat({ channel, profile, demo, compact = false }: { channel: Channel; profile: Profile; demo: boolean; compact?: boolean }) {
  const [messages, setMessages] = useState<Message[]>(demo ? demoMessages.filter(m => m.channel_id === channel.id) : [])
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(!demo)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const nearBottom = useRef(true)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (demo) return
    let alive = true
    async function load() {
      const { data, error } = await db().from('ddtal_messages').select('*,author:ddtal_profiles!author_id(*)')
        .eq('channel_id', channel.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE)
      if (!alive) return
      if (error) setError(error.message)
      else {
        setError('')
        setMessages(current => {
          const byId = new Map(current.map(m => [m.id, m]))
          for (const m of data as Message[]) byId.set(m.id, m)
          return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        })
        setHasMore(data.length === PAGE)
      }
      setLoading(false)
    }
    const subscription = db().channel(`ddtal-chat-${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ddtal_messages', filter: `channel_id=eq.${channel.id}` }, () => void load())
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
    // Stable compound cursor also handles simultaneous message timestamps.
    const first = messages[0]
    const { data, error } = await db().from('ddtal_messages').select('*,author:ddtal_profiles!author_id(*)')
      .eq('channel_id', channel.id)
      .or(`created_at.lt.${first.created_at},and(created_at.eq.${first.created_at},id.lt.${first.id})`)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE)
    if (error) toast.error(error.message)
    else { nearBottom.current = false; setMessages(current => [...(data as Message[]).reverse(), ...current]); setHasMore(data.length === PAGE) }
    setLoading(false)
  }
  function chooseFile(next?: File) {
    if (!next) return
    if (!allowedTypes.includes(next.type)) return toast.error('Envie PNG, JPG, WebP, GIF, PDF ou TXT.')
    if (next.size > 20 * 1024 * 1024) return toast.error('O limite por arquivo é 20 MB.')
    setFile(next)
  }
  async function send(event: React.FormEvent) {
    event.preventDefault()
    if ((!content.trim() && !file) || sending) return
    if (demo && file) return toast.info('Entre na sua conta para compartilhar arquivos.')
    const id = crypto.randomUUID()
    const text = content.trim()
    setSending(true)
    let path: string | null = null
    try {
      if (file) {
        path = `${channel.id}/${profile.id}/${id}`
        const { error } = await db().storage.from('ddtal-attachments').upload(path, file, { contentType: file.type, upsert: false })
        if (error) throw error
      }
      const payload = { id, channel_id: channel.id, author_id: profile.id, content: text, attachment_path: path, attachment_name: file?.name || null, attachment_type: file?.type || null }
      let created: Message
      if (demo) created = { ...payload, created_at: new Date().toISOString(), author: profile }
      else {
        const { data, error } = await db().from('ddtal_messages').insert(payload).select('*,author:ddtal_profiles!author_id(*)').single()
        if (error) throw error
        created = data as Message
      }
      if (mounted.current) {
        nearBottom.current = true
        setMessages(current => current.some(m => m.id === id) ? current : [...current, created])
        setContent(''); setFile(null)
      }
    } catch (e) {
      // Preserve uploaded files on ambiguous network failures: the insert may have committed.
      toast.error(errorMessage(e))
    } finally { if (mounted.current) setSending(false) }
  }
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
        const grouped = previous?.author_id === message.author_id && new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() < 300000
        return <article className={`message ${grouped ? 'grouped' : ''}`} key={message.id}>
          {!grouped && <Avatar name={message.author?.display_name || 'Builder'} size="small" />}
          <div className="message-body">
            {!grouped && <div className="message-meta"><strong>{message.author?.display_name || 'Builder'}</strong>{message.author_id === profile.id && <span className="you-tag">você</span>}<time title={new Date(message.created_at).toLocaleString('pt-BR')}>{new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div>}
            {message.content && <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>[Imagem externa: {alt || 'link'}]</span> }}>{message.content}</ReactMarkdown></div>}
            {message.attachment_path && <Attachment message={message} />}
          </div>
        </article>
      })}
    </div>
    <form className="composer-area" onSubmit={send}>
      {file && <div className="file-preview"><FileText size={16} /><span>{file.name}</span><button type="button" className="icon-button" aria-label="Remover arquivo" onClick={() => setFile(null)}><X size={16} /></button></div>}
      <div className="composer">
        <textarea aria-label="Mensagem" placeholder={compact ? 'Faça parte da conversa…' : `Conversar em #${channel.name}`} value={content} maxLength={6000} disabled={sending} rows={compact ? 2 : 1} onChange={e => setContent(e.target.value)}
          onPaste={e => { const image = [...e.clipboardData.files].find(f => f.type.startsWith('image/')); if (image) { e.preventDefault(); chooseFile(image) } }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        <div className="composer-actions"><div><button className="icon-button" type="button" title="Enviar imagem ou arquivo" aria-label="Enviar imagem ou arquivo" disabled={sending} onClick={() => input.current?.click()}><ImagePlus size={19} /></button><button className="icon-button" type="button" title="Adicionar reação à mensagem" aria-label="Adicionar emoji" disabled={sending} onClick={() => setContent(v => v + ' 🙌')}><Smile size={19} /></button></div><button className="send-button" aria-label="Enviar mensagem" disabled={sending || (!content.trim() && !file)}>{sending ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}</button></div>
      </div>
      <input ref={input} type="file" hidden accept={allowedTypes.join(',')} onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = '' }} />
      <span className="composer-hint">{demo ? 'Prévia interativa · mensagens não são publicadas' : 'Enter para enviar · Shift + Enter para nova linha'}</span>
    </form>
  </section>
}
function MessagesIcon() { return <MessageSquare size={26} /> }
