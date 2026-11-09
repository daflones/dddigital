# Discodigital

O espaço da comunidade F.dev para conversar, aprender e construir juntos.

**Frontend:** React + TypeScript + Vite, servido por Nginx no Easypanel.

**Backend:** Supabase do fsociety: Auth, Postgres, Realtime, Storage e Edge Function.

**Áudio e vídeo:** LiveKit, separado do Supabase. Com LiveKit Cloud, apenas um serviço precisa ficar no Easypanel.

Repositório: https://github.com/daflones/dddigital

## Recursos desta versão

- Cadastro, login por e-mail/senha, Google e recuperação de senha; integração com o Turnstile exigido pelo Supabase compartilhado.
- Perfil com nome e identificador para solicitações de amizade.
- Criação de servidores, canais de texto e salas de voz.
- Convites com validade de 7 dias e limite de 100 novos participantes.
- Chat persistente com Markdown, busca, paginação e atualizações em tempo real.
- Imagens originais sem redimensionamento e anexos PNG/JPG/WebP/GIF/PDF/TXT de até 20 MB, em bucket privado.
- Solicitações de amizade, aceite, mensagens diretas e sala de chamada privada.
- Voz, câmera, transmissão de tela com alvo de 1080p/30 fps, seleção entre apresentações e áudio da aba quando o navegador oferece suporte.
- Microfone, câmera, áudio recebido, mão levantada e saída da sala.
- Ponteiro e desenhos sincronizados sobre a transmissão; cada participante apaga apenas os próprios desenhos.
- Notas da turma em Markdown: equipe edita, alunos leem, todos podem baixar. Gravação com controle de versão para impedir sobrescrita silenciosa.
- Interface em português, responsiva, com prévia interativa claramente identificada em `/?demo=1`.

As marcações sobre a tela são temporárias e vistas por quem já está conectado. As notas ficam no banco. O pacote não inclui gravação, transcrição, quadro infinito, notificações push ou moderação avançada de chamadas. Uma ligação direta é uma sala para os dois amigos; ainda não há toque/chamada recebida em segundo plano.

## Desenvolvimento

Requer Node.js 24.

```sh
npm ci
cp .env.example .env.local
# Preencha apenas as três configurações públicas do frontend.
npm run dev
```

Acesse http://localhost:5173. A prévia em http://localhost:5173/?demo=1 não exige conta. Para usar o backend, informe as chaves públicas; nunca coloque service-role, token administrativo ou segredo LiveKit em variáveis `VITE_*`.

No ambiente original, as configurações públicas foram copiadas do fsociety para `.env.local`, que é ignorado pelo Git. A configuração de CAPTCHA depende também de o hostname estar autorizado no widget Turnstile do Cloudflare.

## Backend

Projeto Supabase compartilhado: `ruisoxcbuiuktffsqcro`.

Todos os objetos da aplicação têm prefixo `ddtal_`. O bucket é `ddtal-attachments`. As tabelas do fsociety e do SeekerAI não são usadas como tabelas de domínio do Discodigital. As contas de Auth pertencem ao mesmo projeto compartilhado.

O baseline em `supabase/migrations/202611090001_ddtal_core.sql` cria as tabelas, funções, RLS, bucket privado e publicação de Realtime. **Já foi aplicado no projeto original.** Não reaplique o baseline nem rode um `supabase db push` indiscriminado nesse banco compartilhado. O script administrativo recusa reaplicar o baseline se as tabelas já existem.

A Edge Function `ddtal-livekit-token` verifica o JWT com `auth.getUser`, aplica as permissões da conta via RLS e gera tokens de 15 minutos restritos ao canal autorizado. Não aceita identidade, nome de sala ou privilégios enviados pelo navegador. O `verify_jwt = false` do gateway é intencional: a verificação real dentro da função suporta as chaves modernas do Supabase.

## Deploy

Instruções completas: [docs/DEPLOY.md](docs/DEPLOY.md).

O Dockerfile gera uma SPA estática e a serve na porta **80**. As variáveis `VITE_*` são **argumentos de build**. Alterá-las exige rebuild.

Para ativar mídia, configure no Supabase:

```dotenv
DDTAL_LIVEKIT_URL=wss://SEU-PROJETO.livekit.cloud
DDTAL_LIVEKIT_API_KEY=...
DDTAL_LIVEKIT_API_SECRET=...
DDTAL_ALLOWED_ORIGINS=https://SEU-DOMINIO,http://localhost:5173
```

O Supabase não retransmite vídeo. A arquitetura com um único container no Easypanel usa LiveKit Cloud para isso. A alternativa é hospedar um servidor LiveKit separado, com UDP/TCP e TURN adequadamente configurados.

## Verificação

```sh
npm run build
npx playwright install chromium
npm test
```

Os testes de navegador cobrem prévia, chat, notas, navegação mobile e formulários de autenticação. O teste SQL valida regras de permissão com contas fictícias dentro de uma transação revertida.

Para verificações autorizadas contra o Supabase compartilhado, informe o caminho de um dotenv administrativo local. Os scripts leem os segredos diretamente, sem imprimi-los:

```sh
node scripts/supabase-admin.mjs test /caminho/seguro/.env.local
node scripts/verify-integration.mjs /caminho/seguro/.env.local
```

A integração cria duas contas descartáveis, usa sessões Auth emitidas pelo fluxo administrativo de magic link, abre dois navegadores, valida convites, Realtime, anexos, notas, amizade, conversa privada e autorização da Edge Function. Remove as contas e os dados ao terminar. Não envia e-mails nem desativa CAPTCHA. Login por senha com CAPTCHA e OAuth Google precisam de validação humana no domínio final.

Também há teste opcional com um SFU LiveKit local:

```sh
docker run --rm --name ddtal-livekit-test \
  -p 127.0.0.1:7880:7880 -p 127.0.0.1:7881:7881 -p 127.0.0.1:7882:7882/udp \
  livekit/livekit-server:v1.13.11 --dev --bind 0.0.0.0 --node-ip 127.0.0.1
node scripts/verify-integration.mjs /caminho/seguro/.env.local --media
```

Esse teste usa câmera/áudio sintéticos e substitui a origem da captura de tela apenas no navegador de teste. Valida transporte WebRTC real, reprodução, desenhos, ponteiro, mão levantada e desconexão. Não comprova a qualidade de uma transmissão Full HD nem o comportamento entre redes distintas.

## Referências e decisões

[Pesquisa técnica de bibliotecas no GitHub](docs/RESEARCH.md), com comparação de LiveKit, mediasoup, Jitsi, Excalidraw, tldraw, Yjs, Tiptap e integrações.
