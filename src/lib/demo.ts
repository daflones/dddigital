import type { Channel, Membership, Message, Profile, Server } from './types'

export const demoProfile: Profile = { id: 'demo-you', display_name: 'Você', handle: 'visitante' }
export const demoServer: Server = { id: 'demo-server', name: 'F.dev • Builders', description: '30 dias para tirar sua ideia do papel.', owner_id: 'demo-daflon' }
export const demoChannels: Channel[] = [
  { id: 'demo-welcome', server_id: demoServer.id, name: 'boas-vindas', kind: 'text', topic: 'Toda grande ideia começa com uma boa conexão.' },
  { id: 'demo-announcements', server_id: demoServer.id, name: 'avisos', kind: 'text', topic: 'Novidades e próximos encontros da comunidade.' },
  { id: 'demo-general', server_id: demoServer.id, name: 'geral', kind: 'text', topic: 'Ideias, descobertas e boas conversas.' },
  { id: 'demo-questions', server_id: demoServer.id, name: 'tira-dúvidas', kind: 'text', topic: 'Nenhuma dúvida fica para trás.' },
  { id: 'demo-projects', server_id: demoServer.id, name: 'projetos', kind: 'text', topic: 'Compartilhe o que você está construindo.' },
  { id: 'demo-class', server_id: demoServer.id, name: 'Sala de aula', kind: 'voice', topic: 'Um espaço para aprender fazendo. Juntos.' },
  { id: 'demo-cowork', server_id: demoServer.id, name: 'Coworking', kind: 'voice', topic: 'Abra seu editor e venha construir com a comunidade.' },
]
export const demoMembers: Membership[] = [
  { user_id: 'demo-daflon', role: 'owner', profile: { id: 'demo-daflon', display_name: 'Eduardo Daflon', handle: 'daflon' } },
  { user_id: 'demo-ana', role: 'member', profile: { id: 'demo-ana', display_name: 'Ana Costa', handle: 'anacosta' } },
  { user_id: 'demo-lucas', role: 'member', profile: { id: 'demo-lucas', display_name: 'Lucas Martins', handle: 'lucasm' } },
  { user_id: demoProfile.id, role: 'member', profile: demoProfile },
]
export const demoMessages: Message[] = [
  { id: 'demo-m1', channel_id: 'demo-class', author_id: 'demo-daflon', content: 'Bem-vindos ao nosso espaço! 👋\nAqui a gente aprende construindo. Separem as ideias e tragam as dúvidas.', created_at: '2026-11-09T17:00:00Z', attachment_path: null, attachment_name: null, attachment_type: null, author: demoMembers[0].profile },
  { id: 'demo-m2', channel_id: 'demo-class', author_id: 'demo-ana', content: 'Tudo pronto por aqui! Animada para tirar o projeto do papel 🚀', created_at: '2026-11-09T17:02:00Z', attachment_path: null, attachment_name: null, attachment_type: null, author: demoMembers[1].profile },
  { id: 'demo-m3', channel_id: 'demo-class', author_id: 'demo-lucas', content: 'Esse espaço ficou muito bom. Bora construir!', created_at: '2026-11-09T17:03:00Z', attachment_path: null, attachment_name: null, attachment_type: null, author: demoMembers[2].profile },
]
