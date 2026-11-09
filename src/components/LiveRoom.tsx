import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LiveKitRoom, RoomAudioRenderer, VideoTrack, useConnectionState, useLocalParticipant, useParticipants, useRoomContext, useTracks } from '@livekit/components-react'
import type { TrackReference } from '@livekit/components-react'
import { ConnectionState, LocalAudioTrack, RoomEvent, ScreenSharePresets, Track } from 'livekit-client'
import type { RemoteParticipant } from 'livekit-client'
import { BadgeCheck, Camera, CameraOff, Hand, Maximize2, Mic, MicOff, MonitorUp, MousePointer2, Pencil, PhoneOff, PictureInPicture2, Trash2, UserMinus, Volume2, VolumeX, Volume1 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from './ui'
import type { Channel, RoomCredentials } from '../lib/types'
import { errorMessage } from '../lib/supabase'
import { createMicChain, loadVoice, VOICE_EVENT } from '../lib/voice'
import type { MicChain } from '../lib/voice'
import '@livekit/components-styles'

type Point = { x: number; y: number }
type Stroke = { id: string; points: Point[]; owner: string }
type Tool = 'view' | 'laser' | 'pen'
type ModerateAction = 'mute_mic' | 'unmute_mic' | 'kick' | 'move'
type Moderate = (action: ModerateAction, targetUserId: string, destinationChannelId?: string) => Promise<{ ok?: boolean; action?: string; via?: string; channelId?: string; channelName?: string; error?: string }>
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type ParticipantMeta = { role?: { name: string; color: string } | null; avatar_url?: string | null; name_color?: string | null; name_effect?: string; name_font?: string }
function participantMeta(participant: { metadata?: string }): ParticipantMeta {
  try { return JSON.parse(participant.metadata || '{}') } catch { return {} }
}
function roleBadge(meta: ParticipantMeta) {
  return meta.role?.name ? <span className="tile-role" style={{ color: meta.role.color, borderColor: meta.role.color }}><BadgeCheck size={10} />{meta.role.name}</span> : null
}
function styledTileName(name: string, meta: ParticipantMeta) {
  const effect = meta.name_effect || 'none'
  const font = meta.name_font || 'default'
  const style = meta.name_color && effect !== 'rainbow' ? { color: meta.name_color } : undefined
  if (effect === 'wave') return <span className={`styled-name fx-wave font-${font}`} style={style}>{[...name].map((c, i) => <i key={i} style={{ animationDelay: `${i * 0.07}s` }}>{c === ' ' ? ' ' : c}</i>)}</span>
  return <span className={`styled-name fx-${effect} font-${font}`} style={style}>{name}</span>
}

export default function LiveRoom({ credentials, leave, canModerate, moveTargets, moderate, onParticipants }: {
  credentials: RoomCredentials; leave: () => void
  canModerate: boolean; moveTargets: Channel[]; moderate: Moderate
  onParticipants?: (identities: string[]) => void
}) {
  return <LiveKitRoom serverUrl={credentials.url} token={credentials.token} connect audio={false} video={false}
    options={{ adaptiveStream: true, dynacast: true, publishDefaults: { screenShareEncoding: ScreenSharePresets.h1080fps30.encoding, screenShareSimulcastLayers: [ScreenSharePresets.h720fps15] } }}
    onError={error => toast.error(errorMessage(error))} onDisconnected={leave} className="live-room">
    <RoomView canModerate={canModerate} moveTargets={moveTargets} moderate={moderate} onParticipants={onParticipants} />
  </LiveKitRoom>
}

function ScreenSurface({ track, tool }: { track: TrackReference; tool: Tool }) {
  const room = useRoomContext()
  const host = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({ width: 960, height: 540 })
  const [aspect, setAspect] = useState(16 / 9)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [draft, setDraft] = useState<Point[]>([])
  const [laser, setLaser] = useState<(Point & { name: string }) | null>(null)
  const drawing = useRef<Point[]>([])
  const lastSent = useRef(0)
  const laserTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const surface = track.publication.trackSid
  const publish = useCallback((payload: object, reliable = true) => {
    void room.localParticipant.publishData(encoder.encode(JSON.stringify({ ...payload, surface })), { reliable, topic: 'ddtal-tools' }).catch(() => {})
  }, [room, surface])
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setBounds({ width, height })
    })
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setStrokes([]); setDraft([]); setLaser(null)
    const receive = (bytes: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== 'ddtal-tools' || !participant || bytes.byteLength > 32000) return
      try {
        const payload = JSON.parse(decoder.decode(bytes))
        if (payload.surface !== surface) return
        const valid = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100
        if (payload.type === 'stroke' && typeof payload.id === 'string' && payload.id.length <= 64 && Array.isArray(payload.points) && payload.points.length <= 500 && payload.points.every(valid)) {
          setStrokes(current => current.some(s => s.id === payload.id) ? current : [...current.slice(-199), { id: payload.id, points: payload.points, owner: participant.identity }])
        } else if (payload.type === 'laser' && valid(payload.point)) {
          setLaser({ ...payload.point, name: participant.name || 'Builder' })
          clearTimeout(laserTimeout.current)
          laserTimeout.current = setTimeout(() => setLaser(null), 1500)
        } else if (payload.type === 'clear') {
          // A participant can only erase their own annotations.
          setStrokes(current => current.filter(s => s.owner !== participant.identity))
        }
      } catch { /* Discard malformed data packets. */ }
    }
    room.on(RoomEvent.DataReceived, receive)
    return () => { room.off(RoomEvent.DataReceived, receive); clearTimeout(laserTimeout.current) }
  }, [room, surface])
  const width = Math.min(bounds.width, bounds.height * aspect)
  const height = width / aspect
  function point(event: React.PointerEvent<SVGSVGElement>): Point {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(100, (event.clientX - box.left) / box.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - box.top) / box.height * 100)) }
  }
  function finish() {
    if (drawing.current.length > 1) {
      const stroke = { id: crypto.randomUUID(), points: drawing.current, owner: room.localParticipant.identity }
      setStrokes(current => [...current.slice(-199), stroke])
      publish({ type: 'stroke', id: stroke.id, points: stroke.points })
    }
    drawing.current = []; setDraft([])
  }
  return <div className="screen-surface" ref={host}>
    <div className="screen-fit" style={{ width, height }}>
      <VideoTrack trackRef={track} onLoadedMetadata={e => { const video = e.currentTarget; if (video.videoHeight) setAspect(video.videoWidth / video.videoHeight) }} onResize={e => { const video = e.currentTarget; if (video.videoHeight) setAspect(video.videoWidth / video.videoHeight) }} />
      <svg className={`annotation-layer ${tool}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Anotações sobre a tela"
        onPointerDown={e => { if (tool === 'pen') { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = [point(e)]; setDraft(drawing.current) } }}
        onPointerMove={e => {
          if (tool === 'pen' && drawing.current.length && drawing.current.length < 500) { drawing.current = [...drawing.current, point(e)]; setDraft(drawing.current) }
          if (tool === 'laser' && Date.now() - lastSent.current > 55) {
            lastSent.current = Date.now(); const p = point(e); setLaser({ ...p, name: 'Você' }); publish({ type: 'laser', point: p }, false)
          }
        }}
        onPointerUp={finish} onPointerCancel={finish}>
        {strokes.map(s => <polyline key={s.id} points={s.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#b998ff" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />)}
        {draft.length > 0 && <polyline points={draft.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#d5ff85" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
      {laser && <div className="live-laser" style={{ left: `${laser.x}%`, top: `${laser.y}%` }}><i /><span>{laser.name}</span></div>}
      {tool === 'pen' && <button className="clear-annotations" title="Apagar minhas marcações" aria-label="Apagar minhas marcações" onClick={() => { setStrokes(current => current.filter(s => s.owner !== room.localParticipant.identity)); publish({ type: 'clear' }) }}><Trash2 size={16} /></button>}
    </div>
  </div>
}

// Floating picture-in-picture control panel: stays on top of the screen being shared.
function FloatingPanel({ remoteScreen, localScreen, raised, onClose, canModerate, moveTargets, moderate }: {
  remoteScreen?: TrackReference; localScreen?: TrackReference; raised: string[]; onClose: () => void
  canModerate: boolean; moveTargets: Channel[]; moderate: Moderate
}) {
  const room = useRoomContext()
  const participants = useParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant()
  const [busy, setBusy] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  async function action(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  async function mod(action: ModerateAction, p: { identity: string; name?: string }, destinationChannelId?: string) {
    setMenuFor(null)
    const name = p.name || 'Builder'
    try {
      const result = await moderate(action, p.identity, destinationChannelId)
      toast.success(action === 'mute_mic' ? `${name} foi silenciado.` : action === 'unmute_mic' ? `Voz devolvida a ${name}.` : action === 'kick' ? `${name} foi removido da sala.` : `${name} movido para ${result.channelName || 'outra sala'}.`)
    } catch (e) { toast.error(errorMessage(e)) }
  }
  return <div className="pip-panel">
    <div className="pip-header"><span><i className="status-dot" />Painel da sala</span><button aria-label="Fechar painel" onClick={onClose}><PhoneOff size={13} /></button></div>
    {localScreen && <div className="pip-screen"><VideoTrack trackRef={localScreen} /><span>O que a sala está vendo de você</span></div>}
    {remoteScreen && <div className="pip-screen"><VideoTrack trackRef={remoteScreen} /><span>{remoteScreen.participant.name || 'Builder'} está compartilhando</span></div>}
    <div className="pip-people">{participants.map(p => <div key={p.identity} className={`pip-person ${p.isSpeaking ? 'speaking' : ''} ${canModerate && !p.isLocal ? 'moderatable' : ''}`}
      onClick={() => { if (canModerate && !p.isLocal) setMenuFor(menuFor === p.identity ? null : p.identity) }}>
      <Avatar name={p.name || 'Builder'} url={participantMeta(p).avatar_url} size="tiny" /><span>{p.isLocal ? 'Você' : styledTileName(p.name || 'Builder', participantMeta(p))}</span>
      {raised.includes(p.identity) && <Hand size={12} className="raised" />}{p.isMicrophoneEnabled ? <Mic size={11} /> : <MicOff size={11} />}
      {menuFor === p.identity && <div className="pip-menu" onClick={e => e.stopPropagation()}>
        <button onClick={() => void mod(p.isMicrophoneEnabled ? 'mute_mic' : 'unmute_mic', p)}>{p.isMicrophoneEnabled ? <><VolumeX size={13} />Silenciar</> : <><Volume1 size={13} />Devolver a voz</>}</button>
        {moveTargets.map(c => <button key={c.id} onClick={() => void mod('move', p, c.id)}><Volume2 size={13} />Mover para {c.name}</button>)}
        <button className="danger" onClick={() => void mod('kick', p)}><UserMinus size={13} />Expulsar da sala</button>
      </div>}
    </div>)}</div>
    <div className="pip-controls">
      <button className={!isMicrophoneEnabled ? 'off' : ''} disabled={busy} title={isMicrophoneEnabled ? 'Desativar microfone' : 'Ativar microfone'} onClick={() => void action(async () => { const t = localParticipant.getTrackPublication(Track.Source.Microphone)?.track; if (t) await (t.isMuted ? t.unmute() : t.mute()) })}>{isMicrophoneEnabled ? <Mic size={16} /> : <MicOff size={16} />}</button>
      <button disabled={busy} title={isCameraEnabled ? 'Desativar câmera' : 'Ativar câmera'} onClick={() => void action(() => localParticipant.setCameraEnabled(!isCameraEnabled))}>{isCameraEnabled ? <Camera size={16} /> : <CameraOff size={16} />}</button>
      <button className={isScreenShareEnabled ? 'active' : ''} disabled={busy} title={isScreenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'} onClick={() => void action(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: 'text' }))}><MonitorUp size={16} /></button>
      <button className="hangup" title="Sair da sala" onClick={() => void room.disconnect()}><PhoneOff size={16} /></button>
    </div>
  </div>
}

function ParticipantMenu({ participant, moveTargets, moderate, close }: {
  participant: RemoteParticipant; moveTargets: Channel[]; moderate: Moderate; close: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [close])
  const mic = participant.getTrackPublication(Track.Source.Microphone)
  async function act(action: ModerateAction, destinationChannelId?: string) {
    try {
      const result = await moderate(action, participant.identity, destinationChannelId)
      if (action === 'move') toast.success(result.via === 'livekit' ? `${participant.name} movido para ${result.channelName}.` : `${participant.name} foi desconectado e entrará em ${result.channelName}.`)
      else if (action === 'kick') toast.success(`${participant.name} foi removido da sala.`)
      else toast.success(action === 'mute_mic' ? `${participant.name} foi silenciado.` : `Voz devolvida a ${participant.name}.`)
    } catch (e) { toast.error(errorMessage(e)) }
    close()
  }
  return <div className="moderate-menu" ref={menuRef}>
    {mic && !mic.isMuted && <button onClick={() => void act('mute_mic')}><VolumeX size={15} />Silenciar</button>}
    {mic?.isMuted && <button onClick={() => void act('unmute_mic')}><Volume1 size={15} />Devolver a voz</button>}
    {!mic && <button onClick={() => void act('unmute_mic')}><Volume1 size={15} />Devolver a voz</button>}
    {moveTargets.length > 0 && <button onClick={() => setMoving(!moving)}><Volume2 size={15} />Mover para…</button>}
    {moving && <div className="moderate-submenu">{moveTargets.map(c => <button key={c.id} onClick={() => void act('move', c.id)}><Volume2 size={14} />{c.name}</button>)}</div>}
    <button className="danger" onClick={() => void act('kick')}><UserMinus size={15} />Expulsar da sala</button>
  </div>
}

function RoomView({ canModerate, moveTargets, moderate, onParticipants }: { canModerate: boolean; moveTargets: Channel[]; moderate: Moderate; onParticipants?: (identities: string[]) => void }) {
  const room = useRoomContext()
  const participants = useParticipants()
  useEffect(() => { onParticipants?.(participants.map(p => p.identity)) }, [participants, onParticipants])
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant()
  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera])
  const state = useConnectionState()
  const [tool, setTool] = useState<Tool>('view')
  const [deafened, setDeafened] = useState(false)
  const [raised, setRaised] = useState<string[]>([])
  const [activeScreen, setActiveScreen] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [busy, setBusy] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const screens = tracks.filter(t => t.source === Track.Source.ScreenShare)
  const screen = screens.find(t => t.publication.trackSid === activeScreen) || screens[0]
  const remoteScreen = screens.find(t => !t.participant.isLocal)
  const localScreen = screens.find(t => t.participant.isLocal)
  const meRaised = raised.includes(localParticipant.identity)
  useEffect(() => {
    const receive = (bytes: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== 'ddtal-hand' || !participant || bytes.byteLength > 100) return
      const value = decoder.decode(bytes)
      if (value !== 'up' && value !== 'down') return
      setRaised(current => value === 'up' ? [...new Set([...current, participant.identity])] : current.filter(id => id !== participant.identity))
    }
    const left = (participant: RemoteParticipant) => { setRaised(current => current.filter(id => id !== participant.identity)); setMenuFor(current => current === participant.identity ? null : current) }
    room.on(RoomEvent.DataReceived, receive); room.on(RoomEvent.ParticipantDisconnected, left)
    return () => { room.off(RoomEvent.DataReceived, receive); room.off(RoomEvent.ParticipantDisconnected, left) }
  }, [room])
  // Offer the floating panel as soon as screen sharing starts (needs a user gesture in some browsers).
  useEffect(() => { if (isScreenShareEnabled && !pipWindow) void openPip() }, [isScreenShareEnabled])
  useEffect(() => () => pipWindow?.close(), [pipWindow])
  async function openPip() {
    if (pipWindow && !pipWindow.closed) { pipWindow.focus(); return }
    const api = (window as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture
    if (!api) { toast.info('Seu navegador ainda não abre janelas flutuantes. Use Chrome ou Edge.'); return }
    try {
      const pip = await api.requestWindow({ width: 400, height: 460 })
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          if (sheet.href) { const link = pip.document.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; pip.document.head.appendChild(link) }
          else { const style = pip.document.createElement('style'); style.textContent = Array.from(sheet.cssRules).map(r => r.cssText).join('\n'); pip.document.head.appendChild(style) }
        } catch { /* Skip cross-origin stylesheets. */ }
      }
      pip.document.documentElement.setAttribute('data-theme', 'dark')
      pip.document.body.className = 'pip-body'
      pip.addEventListener('pagehide', () => setPipWindow(null))
      setPipWindow(pip)
    } catch { /* User declined or API unavailable — the in-app controls still work. */ }
  }
  async function action(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn() } catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }
  async function hand() {
    await localParticipant.publishData(encoder.encode(meRaised ? 'down' : 'up'), { reliable: true, topic: 'ddtal-hand' })
    setRaised(current => meRaised ? current.filter(id => id !== localParticipant.identity) : [...current, localParticipant.identity])
  }
  // Voice pipeline: a processed mic (gain + noise gate per user settings) is
  // published instead of LiveKit's raw capture; output device/volume apply to
  // the rendered remote audio elements. Settings changes rebuild live.
  const chainRef = useRef<MicChain | null>(null)
  const [voiceTick, setVoiceTick] = useState(0)
  useEffect(() => {
    const onChange = () => setVoiceTick(v => v + 1)
    window.addEventListener(VOICE_EVENT, onChange)
    return () => window.removeEventListener(VOICE_EVENT, onChange)
  }, [])
  const micTrack = () => localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined
  const toggleMic = () => { const t = micTrack(); return t ? (t.isMuted ? t.unmute() : t.mute()) : Promise.resolve() }
  useEffect(() => {
    if (state !== ConnectionState.Connected) return
    let cancelled = false
    async function setup() {
      const s = loadVoice()
      const chain = await createMicChain(s)
      if (cancelled) { chain.stop(); return }
      const track = new LocalAudioTrack(chain.stream.getAudioTracks()[0])
      await localParticipant.publishTrack(track, { source: Track.Source.Microphone })
      chainRef.current = chain
      if (s.ptt) await track.mute()
    }
    void setup().catch(() => toast.error('Não consegui abrir seu microfone. Confira o dispositivo e a permissão.'))
    return () => {
      cancelled = true
      const t = micTrack()
      if (t) void localParticipant.unpublishTrack(t)
      chainRef.current?.stop()
      chainRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, voiceTick])
  // Push-to-talk: hold the bound key to unmute, release to mute again.
  useEffect(() => {
    const s = loadVoice()
    if (!s.ptt || state !== ConnectionState.Connected) return
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"]')
    const down = (e: KeyboardEvent) => { if (e.code === s.pttKey && !e.repeat && !typing(e)) { const t = micTrack(); if (t?.isMuted) void t.unmute() } }
    const up = (e: KeyboardEvent) => { if (e.code === s.pttKey) { const t = micTrack(); if (t && !t.isMuted) void t.mute() } }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, voiceTick])
  // Output device + volume on the rendered remote audio elements.
  useEffect(() => {
    if (state !== ConnectionState.Connected) return
    const s = loadVoice()
    const root = stage.current?.closest('.live-container') || document.body
    const apply = (el: HTMLMediaElement) => {
      el.volume = Math.min(1, s.outVolume)
      const sink = (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId
      if (s.outputId && sink) void sink.call(el, s.outputId).catch(() => {})
    }
    const applyAll = () => root.querySelectorAll('audio').forEach(apply)
    applyAll()
    const observer = new MutationObserver(applyAll)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, voiceTick])
  return <>
    <RoomAudioRenderer muted={deafened} />
    {pipWindow && createPortal(<FloatingPanel remoteScreen={remoteScreen} localScreen={localScreen} raised={raised} canModerate={canModerate} moveTargets={moveTargets} moderate={moderate} onClose={() => pipWindow.close()} />, pipWindow.document.body)}
    <div className="live-status"><span><i className="status-dot" />{state === ConnectionState.Connected ? 'Você está na sala' : 'Reconectando…'}</span><span>{participants.length} {participants.length === 1 ? 'pessoa' : 'pessoas'} · áudio ao vivo</span></div>
    <div className="live-stage" ref={stage}>
      {screen ? <ScreenSurface key={screen.publication.trackSid} track={screen} tool={tool} /> : <div className="no-share"><div className="no-share-icon"><MonitorUp size={42} /></div><span className="eyebrow">ESPAÇO PARA SUAS IDEIAS</span><h2>Mostre o que você está construindo.</h2><p>Compartilhe uma aba, janela ou sua tela inteira.<br />A turma acompanha e participa aqui.</p><button className="primary" disabled={busy} onClick={() => void action(() => localParticipant.setScreenShareEnabled(true, { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: 'text' }))}><MonitorUp size={17} />Compartilhar minha tela</button></div>}
      {screen && <div className="screen-tools"><span>{screen.participant.name || 'Builder'} está apresentando</span><button className={tool === 'view' ? 'active' : ''} title="Assistir" aria-label="Assistir" onClick={() => setTool('view')}><MousePointer2 size={17} /></button><button className={tool === 'laser' ? 'active' : ''} title="Ponteiro ao vivo" aria-label="Ponteiro ao vivo" onClick={() => setTool('laser')}><span className="laser-icon" /></button><button className={tool === 'pen' ? 'active' : ''} title="Desenhar sobre a tela" aria-label="Desenhar sobre a tela" onClick={() => setTool('pen')}><Pencil size={17} /></button><button title="Tela cheia" aria-label="Tela cheia" onClick={() => void action(() => document.fullscreenElement ? document.exitFullscreen() : stage.current!.requestFullscreen())}><Maximize2 size={17} /></button></div>}
    </div>
    {screens.length > 1 && <div className="screen-selector">{screens.map(s => <button key={s.publication.trackSid} className={s === screen ? 'selected' : ''} onClick={() => setActiveScreen(s.publication.trackSid)}><MonitorUp size={14} /> {s.participant.name}</button>)}</div>}
    <div className="participant-strip">{participants.map(p => {
      const camera = tracks.find(t => t.participant.identity === p.identity && t.source === Track.Source.Camera)
      return <div className={`participant-tile ${p.isSpeaking ? 'speaking' : ''}`} key={p.identity}>
        {camera ? <VideoTrack trackRef={camera} /> : <Avatar name={p.name || 'Builder'} url={participantMeta(p).avatar_url} />}
        <div><span>{p.isLocal ? 'Você' : styledTileName(p.name || 'Builder', participantMeta(p))}{roleBadge(participantMeta(p))}</span>{raised.includes(p.identity) && <Hand size={14} className="raised" />}{p.isMicrophoneEnabled ? <Mic size={13} /> : <MicOff size={13} />}</div>
        {canModerate && !p.isLocal && <button className="tile-moderate" aria-label={`Moderar ${p.name}`} title="Moderar participante" onClick={() => setMenuFor(menuFor === p.identity ? null : p.identity)}><Volume2 size={14} /></button>}
        {canModerate && !p.isLocal && menuFor === p.identity && <ParticipantMenu participant={p as RemoteParticipant} moveTargets={moveTargets} moderate={moderate} close={() => setMenuFor(null)} />}
      </div>
    })}</div>
    <div className="call-controls">
      <div><button className={!isMicrophoneEnabled ? 'off' : ''} disabled={busy} title={isMicrophoneEnabled ? 'Desativar microfone' : 'Ativar microfone'} aria-label={isMicrophoneEnabled ? 'Desativar microfone' : 'Ativar microfone'} onClick={() => void action(toggleMic)}>{isMicrophoneEnabled ? <Mic /> : <MicOff />}</button><button disabled={busy} title={isCameraEnabled ? 'Desativar câmera' : 'Ativar câmera'} aria-label={isCameraEnabled ? 'Desativar câmera' : 'Ativar câmera'} onClick={() => void action(() => localParticipant.setCameraEnabled(!isCameraEnabled))}>{isCameraEnabled ? <Camera /> : <CameraOff />}</button><button title={deafened ? 'Ouvir a sala' : 'Silenciar áudio recebido'} aria-label={deafened ? 'Ouvir a sala' : 'Silenciar áudio recebido'} onClick={() => setDeafened(!deafened)}>{deafened ? <VolumeX /> : <Volume2 />}</button></div>
      <button className={`share-control ${isScreenShareEnabled ? 'active' : ''}`} disabled={busy} onClick={() => void action(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: 'text' }))}><MonitorUp size={19} /><span>{isScreenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'}</span></button>
      <div><button title="Painel flutuante (controla a sala sobre a tela compartilhada)" aria-label="Abrir painel flutuante" onClick={() => void openPip()}><PictureInPicture2 /></button><button className={meRaised ? 'active' : ''} title={meRaised ? 'Abaixar mão' : 'Levantar mão'} aria-label={meRaised ? 'Abaixar mão' : 'Levantar mão'} onClick={() => void action(hand)}><Hand /></button><button className="hangup" title="Sair da sala" aria-label="Sair da sala" onClick={() => void room.disconnect()}><PhoneOff /></button></div>
    </div>
    <div className="live-footnote">Compartilhamento em até 1080p · A qualidade se adapta à conexão · Marcações são temporárias</div>
  </>
}
