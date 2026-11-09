import { useState } from 'react'
import { ArrowUpRight, AudioLines, Check, Code2, Hand, Maximize2, Mic, MonitorUp, MousePointer2, Pencil, Radio, Sparkles, Volume2 } from 'lucide-react'
import type { Channel, Membership } from '../lib/types'
import { Avatar } from './ui'

export function ClassroomLobby({ channel, members, demo, joining, join }: { channel: Channel; members: Membership[]; demo: boolean; joining: boolean; join: () => void }) {
  const [tool, setTool] = useState('pointer')
  return <div className="classroom-lobby">
    <div className="room-intro"><div><span className="eyebrow">APRENDER. CONSTRUIR. COMPARTILHAR.</span><h1>Grandes ideias merecem<br />um espaço <span>à altura.</span></h1><p>Conecte sua voz. Compartilhe sua visão.<br />O próximo passo fica melhor em comunidade.</p></div><div className="intro-orbit"><div className="orbit-circle orbit-one" /><div className="orbit-circle orbit-two" /><div className="orbit-core"><AudioLines size={44} /></div><span className="orbit-badge"><Sparkles size={15} /> Feito de conexões</span><i /><i /></div></div>
    <div className="stage-title"><div><span className="status-dot" /><h2>{channel.name}</h2><span className="subtle-badge">{demo ? 'PRÉVIA DA SALA' : 'SALA DE VOZ'}</span></div><span><Volume2 size={14} /> Um lugar para estar junto</span></div>
    <div className="demo-stage">
      <div className="demo-stage-top"><span><span className="window-dot" /><span className="window-dot" /><span className="window-dot" /><span className="demo-file">hello-future.tsx</span></span><span><Code2 size={13} /> SEU PRÓXIMO PROJETO</span></div>
      <div className="code-scene">
        <div className="code-numbers">01<br />02<br />03<br />04<br />05<br />06<br />07<br />08<br />09</div>
        <pre><span className="syntax-comment">// coisas incríveis não se constroem sozinho.</span>{'\n'}<span className="syntax-purple">const</span> <span className="syntax-yellow">próximoNível</span> = {'{'}{'\n'}  ideia: <span className="syntax-green">'algo que faz a diferença'</span>,{'\n'}  comunidade: <span className="syntax-green">'pessoas que somam'</span>,{'\n'}  processo: [<span className="syntax-green">'aprender'</span>, <span className="syntax-green">'construir'</span>],{'\n'}  possibilidades: <span className="syntax-orange">Infinity</span>{'\n'}{'}'};{'\n\n'}<span className="syntax-purple">await</span> <span className="syntax-blue">começar</span>(próximoNível);<span className="code-caret" /></pre>
        <div className="code-note"><span className="note-pin" /><span>Uma ideia.<br />30 dias.<br /><strong>Vamos construir?</strong></span><ArrowUpRight size={27} /></div>
      </div>
      <div className="demo-stage-bottom"><span><Check size={13} /> Pronto para o próximo passo</span><span>UTF-8 <span>TypeScript React</span></span></div>
      <div className="preview-toolbox">{[{ id: 'pointer', icon: MousePointer2, name: 'Ponteiro' }, { id: 'pen', icon: Pencil, name: 'Anotação' }, { id: 'screen', icon: MonitorUp, name: 'Compartilhar tela' }].map(t => <button key={t.id} aria-label={t.name} title={t.name} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)}><t.icon size={18} /></button>)}<span /><button aria-label="Conhecer a sala" title="Entrar para usar as ferramentas" onClick={join}><Maximize2 size={17} /></button></div>
    </div>
    <div className="lobby-info"><span><MonitorUp size={14} /> Tela nítida, ideias claras <i /> Compartilhamento em até 1080p</span><span>{demo ? 'Ilustração da experiência' : 'Sua transmissão aparecerá aqui'}</span></div>
    <div className="connection-card"><div className="connection-icon"><Radio size={24} /></div><div><h3>A conversa fica melhor com você.</h3><p>{demo ? 'Entre na sua conta para se conectar com a turma.' : 'Entre na sala para ativar voz, câmera e compartilhamento.'}</p></div><button className="primary" disabled={joining} onClick={join}><Mic size={17} />{joining ? 'Conectando…' : 'Entrar na sala'}<ArrowUpRight size={16} /></button></div>
    <div className="classroom-footer"><div className="avatar-stack">{members.slice(0, 4).map(m => <Avatar key={m.user_id} name={m.profile.display_name} size="tiny" />)}<span>{demo ? 'Seu próximo grupo de builders' : `${members.length} ${members.length === 1 ? 'pessoa faz' : 'pessoas fazem'} parte deste espaço`}</span></div><span><Hand size={14} /> Aqui, toda pergunta importa.</span></div>
  </div>
}
