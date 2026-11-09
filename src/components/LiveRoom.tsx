import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveKitRoom, RoomAudioRenderer, VideoTrack, useConnectionState, useLocalParticipant, useParticipants, useRoomContext, useTracks } from '@livekit/components-react'
import type { TrackReference } from '@livekit/components-react'
import { ConnectionState, RoomEvent, ScreenSharePresets, Track } from 'livekit-client'
import type { RemoteParticipant } from 'livekit-client'
import { Camera, CameraOff, Hand, Maximize2, Mic, MicOff, MonitorUp, MousePointer2, Pencil, PhoneOff, Trash2, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from './ui'
import type { RoomCredentials } from '../lib/types'
import { errorMessage } from '../lib/supabase'
import '@livekit/components-styles'

type Point = { x: number; y: number }
type Stroke = { id: string; points: Point[]; owner: string }
type Tool = 'view' | 'laser' | 'pen'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export default function LiveRoom({ credentials, leave }: { credentials: RoomCredentials; leave: () => void }) {
  return <LiveKitRoom serverUrl={credentials.url} token={credentials.token} connect audio={false} video={false}
    options={{ adaptiveStream: true, dynacast: true, publishDefaults: { screenShareEncoding: ScreenSharePresets.h1080fps30.encoding, screenShareSimulcastLayers: [ScreenSharePresets.h720fps15] } }}
    onError={error => toast.error(errorMessage(error))} onDisconnected={leave} className="live-room">
    <RoomView />
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

function RoomView() {
  const room = useRoomContext()
  const participants = useParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant()
  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera])
  const state = useConnectionState()
  const [tool, setTool] = useState<Tool>('view')
  const [deafened, setDeafened] = useState(false)
  const [raised, setRaised] = useState<string[]>([])
  const [activeScreen, setActiveScreen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const screens = tracks.filter(t => t.source === Track.Source.ScreenShare)
  const screen = screens.find(t => t.publication.trackSid === activeScreen) || screens[0]
  const meRaised = raised.includes(localParticipant.identity)
  useEffect(() => {
    const receive = (bytes: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== 'ddtal-hand' || !participant || bytes.byteLength > 100) return
      const value = decoder.decode(bytes)
      if (value !== 'up' && value !== 'down') return
      setRaised(current => value === 'up' ? [...new Set([...current, participant.identity])] : current.filter(id => id !== participant.identity))
    }
    const left = (participant: RemoteParticipant) => setRaised(current => current.filter(id => id !== participant.identity))
    room.on(RoomEvent.DataReceived, receive); room.on(RoomEvent.ParticipantDisconnected, left)
    return () => { room.off(RoomEvent.DataReceived, receive); room.off(RoomEvent.ParticipantDisconnected, left) }
  }, [room])
  async function action(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn() } catch (e) { toast.error(errorMessage(e)) }
    finally { setBusy(false) }
  }
  async function hand() {
    await localParticipant.publishData(encoder.encode(meRaised ? 'down' : 'up'), { reliable: true, topic: 'ddtal-hand' })
    setRaised(current => meRaised ? current.filter(id => id !== localParticipant.identity) : [...current, localParticipant.identity])
  }
  return <>
    <RoomAudioRenderer muted={deafened} />
    <div className="live-status"><span><i className="status-dot" />{state === ConnectionState.Connected ? 'Você está na sala' : 'Reconectando…'}</span><span>{participants.length} {participants.length === 1 ? 'pessoa' : 'pessoas'} · áudio ao vivo</span></div>
    <div className="live-stage" ref={stage}>
      {screen ? <ScreenSurface key={screen.publication.trackSid} track={screen} tool={tool} /> : <div className="no-share"><div className="no-share-icon"><MonitorUp size={42} /></div><span className="eyebrow">ESPAÇO PARA SUAS IDEIAS</span><h2>Mostre o que você está construindo.</h2><p>Compartilhe uma aba, janela ou sua tela inteira.<br />A turma acompanha e participa aqui.</p><button className="primary" disabled={busy} onClick={() => void action(() => localParticipant.setScreenShareEnabled(true, { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: 'text' }))}><MonitorUp size={17} />Compartilhar minha tela</button></div>}
      {screen && <div className="screen-tools"><span>{screen.participant.name || 'Builder'} está apresentando</span><button className={tool === 'view' ? 'active' : ''} title="Assistir" aria-label="Assistir" onClick={() => setTool('view')}><MousePointer2 size={17} /></button><button className={tool === 'laser' ? 'active' : ''} title="Ponteiro ao vivo" aria-label="Ponteiro ao vivo" onClick={() => setTool('laser')}><span className="laser-icon" /></button><button className={tool === 'pen' ? 'active' : ''} title="Desenhar sobre a tela" aria-label="Desenhar sobre a tela" onClick={() => setTool('pen')}><Pencil size={17} /></button><button title="Tela cheia" aria-label="Tela cheia" onClick={() => void action(() => document.fullscreenElement ? document.exitFullscreen() : stage.current!.requestFullscreen())}><Maximize2 size={17} /></button></div>}
    </div>
    {screens.length > 1 && <div className="screen-selector">{screens.map(s => <button key={s.publication.trackSid} className={s === screen ? 'selected' : ''} onClick={() => setActiveScreen(s.publication.trackSid)}><MonitorUp size={14} /> {s.participant.name}</button>)}</div>}
    <div className="participant-strip">{participants.map(p => {
      const camera = tracks.find(t => t.participant.identity === p.identity && t.source === Track.Source.Camera)
      return <div className={`participant-tile ${p.isSpeaking ? 'speaking' : ''}`} key={p.identity}>{camera ? <VideoTrack trackRef={camera} /> : <Avatar name={p.name || 'Builder'} />}<div><span>{p.isLocal ? 'Você' : p.name || 'Builder'}</span>{raised.includes(p.identity) && <Hand size={14} className="raised" />}{p.isMicrophoneEnabled ? <Mic size={13} /> : <MicOff size={13} />}</div></div>
    })}</div>
    <div className="call-controls">
      <div><button className={!isMicrophoneEnabled ? 'off' : ''} disabled={busy} title={isMicrophoneEnabled ? 'Desativar microfone' : 'Ativar microfone'} aria-label={isMicrophoneEnabled ? 'Desativar microfone' : 'Ativar microfone'} onClick={() => void action(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))}>{isMicrophoneEnabled ? <Mic /> : <MicOff />}</button><button disabled={busy} title={isCameraEnabled ? 'Desativar câmera' : 'Ativar câmera'} aria-label={isCameraEnabled ? 'Desativar câmera' : 'Ativar câmera'} onClick={() => void action(() => localParticipant.setCameraEnabled(!isCameraEnabled))}>{isCameraEnabled ? <Camera /> : <CameraOff />}</button><button title={deafened ? 'Ouvir a sala' : 'Silenciar áudio recebido'} aria-label={deafened ? 'Ouvir a sala' : 'Silenciar áudio recebido'} onClick={() => setDeafened(!deafened)}>{deafened ? <VolumeX /> : <Volume2 />}</button></div>
      <button className={`share-control ${isScreenShareEnabled ? 'active' : ''}`} disabled={busy} onClick={() => void action(() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { audio: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: 'text' }))}><MonitorUp size={19} /><span>{isScreenShareEnabled ? 'Parar de compartilhar' : 'Compartilhar tela'}</span></button>
      <div><button className={meRaised ? 'active' : ''} title={meRaised ? 'Abaixar mão' : 'Levantar mão'} aria-label={meRaised ? 'Abaixar mão' : 'Levantar mão'} onClick={() => void action(hand)}><Hand /></button><button className="hangup" title="Sair da sala" aria-label="Sair da sala" onClick={() => void room.disconnect()}><PhoneOff /></button></div>
    </div>
    <div className="live-footnote">Compartilhamento em até 1080p · A qualidade se adapta à conexão · Marcações são temporárias</div>
  </>
}
