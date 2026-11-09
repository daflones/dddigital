// Per-device voice settings (localStorage — not synced, they describe this
// machine's hardware) plus a WebAudio mic pipeline: gain -> noise gate ->
// destination stream, published into LiveKit in place of the raw capture.

export type VoiceSettings = {
  inputId: string      // '' = browser default
  outputId: string
  micVolume: number    // 0.1 - 2.0 gain multiplier
  outVolume: number    // 0 - 1 applied to remote audio elements
  sensitivity: number  // 0 - 100 gate threshold
  ptt: boolean
  pttKey: string       // KeyboardEvent.code
}

const KEY = 'ddtal_voice'
export const VOICE_EVENT = 'ddtal-voice-change'

export const defaultVoice: VoiceSettings = {
  inputId: '', outputId: '', micVolume: 1, outVolume: 1, sensitivity: 25, ptt: false, pttKey: 'Space',
}

export function loadVoice(): VoiceSettings {
  try {
    return { ...defaultVoice, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<VoiceSettings>) }
  } catch { return { ...defaultVoice } }
}

export function saveVoice(settings: VoiceSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings))
  window.dispatchEvent(new Event(VOICE_EVENT))
}

// Maps the 0-100 slider to an RMS gate threshold (~0-0.12 covers quiet mics).
export function gateThreshold(sensitivity: number): number {
  return (Math.min(100, Math.max(0, sensitivity)) / 100) * 0.12
}

export type MicChain = {
  stream: MediaStream
  level: () => number             // 0-1 RMS of the raw input (for the meter)
  setVolume: (v: number) => void
  setSensitivity: (v: number) => void
  stop: () => void
}

// Builds the processed mic stream. The gate zeroes buffers whose RMS is below
// the configured threshold so background noise never reaches the room.
export async function createMicChain(settings: VoiceSettings): Promise<MicChain> {
  const raw = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: settings.inputId ? { exact: settings.inputId } : undefined,
      echoCancellation: true, noiseSuppression: true, autoGainControl: false,
    },
  })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(raw)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  const gain = ctx.createGain()
  gain.gain.value = settings.micVolume
  let threshold = gateThreshold(settings.sensitivity)
  const gate = ctx.createScriptProcessor(2048, 1, 1)
  gate.onaudioprocess = e => {
    const input = e.inputBuffer.getChannelData(0)
    const out = e.outputBuffer.getChannelData(0)
    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
    if (Math.sqrt(sum / input.length) < threshold) out.fill(0)
    else out.set(input)
  }
  const destination = ctx.createMediaStreamDestination()
  source.connect(analyser)
  source.connect(gain)
  gain.connect(gate)
  gate.connect(destination)
  const samples = new Float32Array(analyser.fftSize)
  return {
    stream: destination.stream,
    level: () => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
      return Math.min(1, Math.sqrt(sum / samples.length) * 4)
    },
    setVolume: v => { gain.gain.value = v },
    setSensitivity: v => { threshold = gateThreshold(v) },
    stop: () => {
      gate.onaudioprocess = null
      for (const node of [source, analyser, gain, gate]) try { node.disconnect() } catch { /* already disconnected */ }
      raw.getTracks().forEach(t => t.stop())
      void ctx.close()
    },
  }
}

export type Devices = { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }

// Device labels require a prior mic permission grant.
export async function listDevices(): Promise<Devices> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return {
    inputs: devices.filter(d => d.kind === 'audioinput'),
    outputs: devices.filter(d => d.kind === 'audiooutput'),
  }
}
