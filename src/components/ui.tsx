import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function Avatar({ name, size = '', online = false }: { name: string; size?: string; online?: boolean }) {
  const hue = [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 360
  return <span className={`avatar ${size}`} style={{ background: `hsl(${hue} 24% 24%)`, color: `hsl(${hue} 65% 83%)` }}>
    {name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
    {online && <i className="online-dot" />}
  </span>
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => ref.current?.close()
  }, [])
  return <dialog ref={ref} className="modal" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fechar" onClick={close}><X size={20} /></button></div>
    {children}
  </dialog>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><img src="/favicon.svg" alt="" />{!compact && <span>disco<span className="brand-light">digital</span><small>BETA</small></span>}</div>
}
