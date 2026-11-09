import { useEffect, useRef, useState } from 'react'
import { Turnstile } from '@marsidev/react-turnstile'
import type { TurnstileInstance } from '@marsidev/react-turnstile'
import { ArrowRight, Github, Radio, MonitorUp, MessagesSquare, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, Brand, StyledName } from './ui'
import { configured, db, errorMessage, serverIconUrl } from '../lib/supabase'
import type { InvitePreview } from '../lib/types'

export function Auth({ onDemo }: { onDemo: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [pending, setPending] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string>()
  const [captchaError, setCaptchaError] = useState(false)
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const captcha = useRef<TurnstileInstance>(null)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  const invite = new URLSearchParams(location.search).get('invite')
  const redirectTo = location.origin + (invite ? `/?invite=${encodeURIComponent(invite)}` : '/')
  useEffect(() => {
    if (!invite || !configured) return
    let active = true
    db().rpc('ddtal_invite_preview', { p_invite: invite })
      .then(({ data, error }) => {
        if (!active) return
        if (error) setPreviewError(errorMessage(error))
        else setPreview(data as InvitePreview)
      })
    return () => { active = false }
  }, [invite])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (siteKey && !captchaToken) return toast.info('Conclua a verificação de segurança para continuar.')
    setPending(true)
    try {
      const email = String(form.get('email'))
      const password = String(form.get('password') || '')
      const result = mode === 'signup'
        ? await db().auth.signUp({ email, password, options: { captchaToken, emailRedirectTo: redirectTo, data: { display_name: String(form.get('name')) } } })
        : mode === 'reset'
          ? await db().auth.resetPasswordForEmail(email, { captchaToken, redirectTo: location.origin + '/?recovery=1' })
          : await db().auth.signInWithPassword({ email, password, options: { captchaToken } })
      if (result.error) throw result.error
      if (mode === 'signup' && !('session' in result.data && result.data.session)) toast.success('Confira seu e-mail para confirmar o cadastro.')
      if (mode === 'reset') toast.success('Se o e-mail estiver cadastrado, você receberá um link de recuperação.')
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setPending(false); setCaptchaToken(undefined); captcha.current?.reset() }
  }
  async function google() {
    try {
      const { error } = await db().auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
      if (error) throw error
    } catch (e) { toast.error(errorMessage(e)) }
  }
  return <main className="auth-page">
    <section className="auth-story">
      <Brand />
      <div className="auth-story-content">
        <div className="eyebrow"><span className="status-dot" /> FEITO PARA CONSTRUIR JUNTOS</div>
        <h1>Seu próximo<br />nível começa<br /><em>com uma conexão.</em></h1>
        <p>O ponto de encontro de quem aprende, compartilha e transforma ideias em realidade.</p>
        <div className="auth-features"><span><Radio /> Conversas de verdade</span><span><MonitorUp /> Aprendizado ao vivo</span><span><MessagesSquare /> Comunidade presente</span></div>
      </div>
      <div className="auth-bottom"><span>UMA NOVA FREQUÊNCIA PARA A F.dev</span><Github size={20} /></div>
    </section>
    <section className="auth-form-side">
      <div className="auth-card">
        <div className="eyebrow">SEU ESPAÇO ESTÁ AQUI</div>
        <h2>{mode === 'signup' ? 'Vamos nos conectar.' : mode === 'reset' ? 'Recupere seu acesso.' : 'Bom ter você de volta.'}</h2>
        {preview ? <div className="invite-preview">
          <div className="invite-server-icon">{serverIconUrl(preview.icon_url) ? <img src={serverIconUrl(preview.icon_url)!} alt="" /> : preview.name.slice(0, 2).toUpperCase()}</div>
          <div className="invite-server-info">
            <strong><StyledName profile={{ display_name: preview.name, name_color: preview.name_color, name_effect: preview.name_effect, name_font: preview.name_font }} /></strong>
            {preview.description && <p>{preview.description}</p>}
            <span className="invite-meta"><Users size={12} />{preview.members} {preview.members === 1 ? 'membro' : 'membros'}</span>
          </div>
          <div className="invite-by"><Avatar name={preview.inviter} url={preview.inviter_avatar} size="tiny" /><span><strong>{preview.inviter}</strong> convidou você</span></div>
        </div> : invite && <p className="muted">{previewError || (configured ? 'Carregando convite…' : 'Você recebeu um convite.')}</p>}
        <p>{invite ? (mode === 'signup' ? 'Crie sua conta e entre direto no servidor.' : 'Entre e você já cai direto no servidor.') : 'Entre na sua conta e faça parte da conversa.'}</p>
        {mode !== 'reset' && <><button className="google-button" disabled={!configured || pending} onClick={google}><b className="google-g">G</b> Continuar com Google</button><div className="divider"><span>ou use seu e-mail</span></div></>}
        <form onSubmit={submit}>
          {mode === 'signup' && <label>Seu nome<input name="name" placeholder="Como podemos chamar você?" required minLength={2} maxLength={60} autoComplete="name" /></label>}
          <label>E-mail<input type="email" name="email" placeholder="voce@exemplo.com" required autoComplete="email" /></label>
          {mode !== 'reset' && <label>Senha<input name="password" type="password" placeholder="Pelo menos 8 caracteres" minLength={8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>}
          {mode === 'login' && <button type="button" className="text-button forgot" onClick={() => setMode('reset')}>Esqueci minha senha</button>}
          {siteKey && <div className="captcha"><Turnstile ref={captcha} siteKey={siteKey} options={{ theme: 'dark', size: 'flexible' }} onSuccess={token => { setCaptchaToken(token); setCaptchaError(false) }} onExpire={() => setCaptchaToken(undefined)} onError={() => { setCaptchaToken(undefined); setCaptchaError(true) }} />{captchaError && <p className="inline-error">A verificação não carregou. Recarregue a página ou continue com Google.</p>}</div>}
          <button className="primary full" disabled={pending || !configured}>{pending ? 'Conectando…' : mode === 'signup' ? 'Criar minha conta' : mode === 'reset' ? 'Enviar link de recuperação' : 'Entrar na comunidade'}<ArrowRight size={18} /></button>
        </form>
        <p className="auth-switch">{mode === 'login' ? 'Ainda não tem uma conta?' : 'Já tem uma conta?'} <button className="text-button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Cadastre-se' : 'Entrar'}</button></p>
        <button className="demo-button" onClick={onDemo}>Conheça o espaço antes de entrar <ArrowRight size={15} /></button>
        {!configured && <p className="muted">Prévia disponível. A conexão será liberada após configurar o Supabase.</p>}
      </div>
      <footer>Menos distância. Mais possibilidades. <span>© {new Date().getFullYear()} discodigital</span></footer>
    </section>
  </main>
}
