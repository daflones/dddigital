import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url, key, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
}) : null

export function db() {
  if (!supabase) throw new Error('Configure o Supabase para conectar sua comunidade.')
  return supabase
}

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(name, args)
  if (error) throw error
  return data as T
}

export function avatarUrl(path?: string | null) {
  if (!path || !supabase) return null
  return supabase.storage.from('ddtal-avatars').getPublicUrl(path).data.publicUrl
}

export function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return 'Não foi possível concluir. Tente novamente.'
}
