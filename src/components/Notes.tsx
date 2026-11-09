import { useEffect, useState } from 'react'
import { Check, Download, FilePenLine, Save } from 'lucide-react'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { db, errorMessage } from '../lib/supabase'

export function Notes({ channelId, userId, canEdit, demo }: { channelId: string; userId: string; canEdit: boolean; demo: boolean }) {
  const [text, setText] = useState(demo ? '# Nosso ponto de partida\n\n- Uma ideia que resolve um problema real\n- Um passo de cada vez\n- Construir, compartilhar, evoluir\n\n> Nenhuma dúvida fica para trás.' : '')
  const [version, setVersion] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(demo)
  const [conflict, setConflict] = useState(false)
  useEffect(() => {
    if (demo) return
    let alive = true
    async function load() {
      const { data, error } = await db().from('ddtal_notes').select('*').eq('channel_id', channelId).maybeSingle()
      if (!alive) return
      if (error) { toast.error(error.message); return }
      if (editing) { if ((data?.updated_at || null) !== version) setConflict(true); return }
      setText(data?.content || ''); setVersion(data?.updated_at || null); setLoaded(true); setConflict(false)
    }
    void load()
    const sub = db().channel(`ddtal-notes-${channelId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'ddtal_notes', filter: `channel_id=eq.${channelId}` }, () => void load()).subscribe()
    return () => { alive = false; void db().removeChannel(sub) }
  }, [channelId, demo, editing, version])
  async function save() {
    setSaving(true)
    try {
      if (!demo) {
        const payload = { channel_id: channelId, content: text, updated_by: userId, updated_at: new Date().toISOString() }
        const result = version
          ? await db().from('ddtal_notes').update(payload).eq('channel_id', channelId).eq('updated_at', version).select().single()
          : await db().from('ddtal_notes').insert(payload).select().single()
        if (result.error) throw new Error('Não foi possível salvar. Outra pessoa pode ter atualizado as notas; copie seu texto e recarregue antes de tentar novamente.')
        setVersion(result.data.updated_at)
      }
      setEditing(false); setConflict(false); toast.success(demo ? 'Notas atualizadas nesta prévia.' : 'Notas compartilhadas com a turma.')
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'anotacoes-ddtal.md'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="notes">
    <div className="notes-heading"><span className="eyebrow">CADERNO DA TURMA</span><button className="icon-button" aria-label="Baixar anotações" title="Baixar anotações" onClick={download}><Download size={17} /></button></div>
    <h3>O conhecimento fica.</h3><p className="muted">Os pontos importantes da aula, sempre por perto.</p>
    {!loaded ? <p>Carregando anotações…</p> : editing ? <textarea className="notes-editor" aria-label="Anotações compartilhadas" value={text} maxLength={30000} onChange={e => setText(e.target.value)} /> : text ? <div className="markdown notes-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>, img: () => null }}>{text}</ReactMarkdown></div> : <div className="empty-chat"><FilePenLine size={30} /><p>Uma página em branco.</p><span>A equipe pode registrar o que importa aqui.</span></div>}
    {conflict && editing && <p className="inline-error">Houve uma atualização. Copie seu texto antes de cancelar e recarregar.</p>}
    {(canEdit || demo) && loaded && <div className="notes-buttons">{editing && <button className="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancelar</button>}<button className="secondary" disabled={saving} onClick={() => editing ? void save() : setEditing(true)}>{editing ? <Save size={15} /> : <FilePenLine size={15} />}{saving ? 'Salvando…' : editing ? 'Salvar para a turma' : 'Editar anotações'}</button></div>}
    {!editing && text && <span className="notes-status"><Check size={13} />{demo ? 'Anotações de exemplo' : 'Compartilhadas neste canal'}</span>}
  </section>
}
