// Tiny WebAudio cues — no audio assets needed. The context is created lazily
// and resumed on first use (browsers require a prior user gesture).
let ctx: AudioContext | null = null
function ac(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// Short pop for incoming chat messages.
export function pop() {
  try {
    const a = ac()
    const o = a.createOscillator()
    const g = a.createGain()
    const t = a.currentTime
    o.type = 'sine'
    o.frequency.setValueAtTime(920, t)
    o.frequency.exponentialRampToValueAtTime(620, t + 0.12)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    o.connect(g).connect(a.destination)
    o.start(t)
    o.stop(t + 0.25)
  } catch { /* audio unavailable */ }
}

// Dual-tone ring (US-style) that loops until the returned stop() is called.
export function startRingtone(): () => void {
  try {
    const a = ac()
    const master = a.createGain()
    master.gain.value = 0
    master.connect(a.destination)
    const oscs = [440, 480].map(freq => {
      const o = a.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq
      o.connect(master)
      o.start()
      return o
    })
    const pulse = () => {
      const t = a.currentTime
      master.gain.cancelScheduledValues(t)
      master.gain.setValueAtTime(0.055, t)
      master.gain.setTargetAtTime(0.0001, t + 1.1, 0.18)
    }
    pulse()
    const id = setInterval(pulse, 2800)
    return () => {
      clearInterval(id)
      try { oscs.forEach(o => o.stop()); master.disconnect() } catch { /* stopped */ }
    }
  } catch {
    return () => { /* noop */ }
  }
}
