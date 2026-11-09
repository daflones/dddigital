import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Mic, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import { createMicChain, gateThreshold, listDevices, loadVoice, saveVoice } from '../lib/voice'
import type { Devices, MicChain, VoiceSettings } from '../lib/voice'

function keyLabel(code: string) {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Space', 'Espaço')
}

// Voice & audio tab inside profile settings. Settings live in localStorage and
// are broadcast via VOICE_EVENT so an open LiveRoom reapplies them on the fly.
export function VoiceSettings() {
  const [s, setS] = useState<VoiceSettings>(loadVoice)
  const [devices, setDevices] = useState<Devices>({ inputs: [], outputs: [] })
  const [listening, setListening] = useState(false)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const chain = useRef<MicChain | null>(null)
  const meter = useRef<number>(0)
  const update = (patch: Partial<VoiceSettings>) => {
    setS(current => {
      const next = { ...current, ...patch }
      chain.current?.setVolume(next.micVolume)
      chain.current?.setSensitivity(next.sensitivity)
      return next
    })
  }
  const stopTest = useCallback(() => {
    cancelAnimationFrame(meter.current)
    chain.current?.stop()
    chain.current = null
    setTesting(false)
    setLevel(0)
  }, [])
  useEffect(() => {
    void navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => { stream.getTracks().forEach(t => t.stop()); return listDevices() })
      .then(setDevices)
      .catch(() => toast.error('Permita o microfone para configurar os dispositivos.'))
    return () => { chain.current?.stop(); chain.current = null; cancelAnimationFrame(meter.current) }
  }, [])
  useEffect(() => {
    if (!listening) return
    const capture = (e: KeyboardEvent) => {
      e.preventDefault()
      update({ pttKey: e.code })
      setListening(false)
    }
    window.addEventListener('keydown', capture, { once: true })
    return () => window.removeEventListener('keydown', capture)
  }, [listening])
  async function testMic() {
    if (testing) return stopTest()
    try {
      const c = await createMicChain({ ...s, sensitivity: s.sensitivity })
      chain.current = c
      setTesting(true)
      const tick = () => { setLevel(c.level()); meter.current = requestAnimationFrame(tick) }
      tick()
      // Record 3s of the PROCESSED stream, then play it back so the user hears
      // exactly what the room will hear (gain + gate applied).
      const recorder = new MediaRecorder(c.stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = e => chunks.push(e.data)
      recorder.onstop = () => {
        stopTest()
        const audio = new Audio(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })))
        audio.volume = Math.min(1, s.outVolume)
        if (s.outputId && 'setSinkId' in audio) void (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(s.outputId).catch(() => {})
        void audio.play().catch(() => toast.error('Não consegui reproduzir o teste.'))
      }
      recorder.start()
      setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop() }, 3000)
    } catch {
      toast.error('Não consegui abrir o microfone. Confira o dispositivo e a permissão.')
      stopTest()
    }
  }
  function save() {
    saveVoice(s)
    toast.success('Configurações de voz salvas.')
  }
  const thresholdPct = (gateThreshold(s.sensitivity) / 0.12) * 100
  return <div className="voice-settings">
    <div className="name-style-row">
      <label className="grow">Dispositivo de entrada
        <select value={s.inputId} onChange={e => update({ inputId: e.target.value })}>
          <option value="">Padrão do sistema</option>
          {devices.inputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </label>
      <label className="grow">Dispositivo de saída
        <select value={s.outputId} onChange={e => update({ outputId: e.target.value })}>
          <option value="">Padrão do sistema</option>
          {devices.outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Saída ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
      </label>
    </div>
    <label>Volume do microfone — {Math.round(s.micVolume * 100)}%
      <input type="range" min={10} max={200} value={Math.round(s.micVolume * 100)} onChange={e => update({ micVolume: Number(e.target.value) / 100 })} />
    </label>
    <label>Volume de saída — {Math.round(s.outVolume * 100)}%
      <input type="range" min={0} max={100} value={Math.round(s.outVolume * 100)} onChange={e => update({ outVolume: Number(e.target.value) / 100 })} />
    </label>
    <label>Sensibilidade do microfone — {s.sensitivity}%
      <input type="range" min={0} max={100} value={s.sensitivity} onChange={e => update({ sensitivity: Number(e.target.value) })} />
    </label>
    <div className="mic-meter">
      <div className="mic-meter-fill" style={{ width: `${Math.min(100, level * 100)}%`, background: level * 100 >= thresholdPct ? 'var(--green)' : '#5c5668' }} />
      <i className="mic-meter-mark" style={{ left: `${thresholdPct}%` }} />
    </div>
    <p className="modal-footnote">A barra mostra seu mic ao vivo durante o teste. O marcador indica a sensibilidade: sons abaixo dele são cortados.</p>
    <label className="check-inline ptt-check"><input type="checkbox" checked={s.ptt} onChange={e => update({ ptt: e.target.checked })} />Apertar para falar</label>
    {s.ptt && <div className="ptt-row">
      <button type="button" className="secondary" onClick={() => setListening(true)}><Keyboard size={15} />{listening ? 'Pressione uma tecla…' : `Atalho: ${keyLabel(s.pttKey)}`}</button>
      <span className="modal-footnote">Segure a tecla para abrir o microfone; solte para silenciar.</span>
    </div>}
    <div className="name-style-row">
      <button type="button" className="secondary grow" onClick={() => void testMic()}>{testing ? <><Square size={15} />Parar teste</> : <><Play size={15} />Testar microfone</>}</button>
      <button type="button" className="primary grow" onClick={save}><Mic size={15} />Salvar voz</button>
    </div>
  </div>
}
