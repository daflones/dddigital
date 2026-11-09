import { useEffect, useRef, useState } from 'react'
import 'emoji-picker-element'
import { Link2, LoaderCircle, Search, X } from 'lucide-react'
import { toast } from 'sonner'

// emoji-picker-element is a web component; React talks to it through props/ref.
const EmojiPickerEl = 'emoji-picker' as unknown as React.FC<{ class?: string; ref?: React.Ref<HTMLElement> }>
const giphyKey = import.meta.env.VITE_GIPHY_API_KEY as string | undefined

type Gif = { id: string; title: string; url: string; preview: string }

export function EmojiGifPicker({ onEmoji, onGif, close }: { onEmoji: (unicode: string) => void; onGif: (url: string) => void; close: () => void }) {
  const [tab, setTab] = useState<'emoji' | 'gif'>('emoji')
  const ref = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    const onPick = (event: Event) => onEmoji((event as CustomEvent<{ unicode: string }>).detail.unicode)
    el?.addEventListener('emoji-click', onPick)
    return () => el?.removeEventListener('emoji-click', onPick)
  }, [onEmoji])
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!host.current?.contains(e.target as Node)) close() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [close])
  return <div className="emoji-picker-pop" ref={host}>
    <div className="picker-tabs">
      <button className={tab === 'emoji' ? 'active' : ''} onClick={() => setTab('emoji')}>Emoji</button>
      <button className={tab === 'gif' ? 'active' : ''} onClick={() => setTab('gif')}>GIF</button>
      <button className="icon-button picker-close" aria-label="Fechar" onClick={close}><X size={15} /></button>
    </div>
    {tab === 'emoji' ? <EmojiPickerEl class="emoji-picker-dark" ref={ref} /> : <GifPanel onGif={onGif} />}
  </div>
}

function GifPanel({ onGif }: { onGif: (url: string) => void }) {
  const [term, setTerm] = useState('')
  const [gifs, setGifs] = useState<Gif[]>([])
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  async function search(q: string) {
    if (!giphyKey || !q.trim()) { setGifs([]); return }
    setBusy(true)
    try {
      const r = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${giphyKey}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`)
      const body = await r.json()
      setGifs((body.data || []).map((g: { id: string; title: string; images: { original: { url: string }; fixed_height_small: { url: string } } }) => ({ id: g.id, title: g.title, url: g.images.original.url, preview: g.images.fixed_height_small.url })))
    } catch { toast.error('Não consegui buscar GIFs agora.') } finally { setBusy(false) }
  }
  function onType(q: string) {
    setTerm(q); setTouched(true)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void search(q), 350)
  }
  function sendUrl(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const url = String(new FormData(e.currentTarget).get('url')).trim()
    if (!/^https:\/\/.+\.(gif|webp)(\?|$)/i.test(url) && !/^https:\/\/(media\d*\.)?giphy\.com\//i.test(url))
      return toast.error('Cole um link https de um .gif/.webp ou do GIPHY.')
    onGif(url)
  }
  return <div className="gif-panel">
    {giphyKey ? <>
      <form className="gif-search" onSubmit={e => { e.preventDefault(); void search(term) }}>
        <Search size={15} /><input value={term} placeholder="Buscar GIF…" onChange={e => onType(e.target.value)} autoFocus />
      </form>
      <div className="gif-grid">
        {busy && <div className="center-muted"><LoaderCircle size={18} className="spin" /></div>}
        {!busy && touched && gifs.length === 0 && <p className="muted">Nenhum GIF encontrado.</p>}
        {!busy && !touched && <p className="muted">Digite para buscar — ex.: comemoração, bug, deploy.</p>}
        {gifs.map(g => <button key={g.id} onClick={() => onGif(g.url)} title={g.title}><img src={g.preview} alt={g.title || 'GIF'} loading="lazy" /></button>)}
      </div>
    </> : <>
      <p className="muted">Sem chave de busca configurada — cole o link de um GIF para enviar.</p>
      <form className="gif-search" onSubmit={sendUrl}>
        <Link2 size={15} /><input name="url" type="url" placeholder="https://…/animacao.gif" required autoFocus />
        <button className="primary" type="submit">Enviar</button>
      </form>
    </>}
  </div>
}
