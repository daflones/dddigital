# Pesquisa de bibliotecas e arquitetura

Pesquisa em 9 de novembro de 2026, consultando os repositórios oficiais no GitHub, seus metadados pela API, licenças e documentação dos SDKs. O foco é uma turma de 30 dias com produto próprio, integração ao Supabase existente e o mínimo de serviços no Easypanel.

## Recomendação

**React + Supabase + LiveKit**. As ferramentas leves de aula usam os data channels do LiveKit para ponteiros e desenhos, e Postgres/Realtime para notas persistentes. Essa divisão evita usar WebSocket de banco como transporte de vídeo.

```text
Navegador
 ├─ Easypanel / Nginx ─── SPA React
 ├─ Supabase Auth ─────── e-mail + Google + Turnstile
 ├─ Postgres / RLS ────── servidores, convites, amigos, mensagens, notas
 ├─ Supabase Realtime ─── alterações autorizadas nas tabelas ddtal_
 ├─ Storage privado ──── imagens e arquivos originais
 └─ Edge Function ────── JWT de sala, após validar conta e acesso
       └─ LiveKit SFU ─── voz + câmera + tela + dados das ferramentas
```

Com LiveKit Cloud, o Easypanel hospeda só o frontend. Supabase Edge Functions servem para chamadas HTTP curtas e emissão de tokens; não são um servidor SFU nem um serviço de vídeo persistente.

## Comunicação

| Biblioteca / projeto | Licença consultada | Adequação e decisão |
| --- | --- | --- |
| [livekit/livekit](https://github.com/livekit/livekit) | Apache-2.0 | **Escolhido.** SFU completo, infraestrutura de salas, distribuição de áudio/vídeo e possibilidade de Cloud ou self-host. A integração pode mudar de hospedagem sem trocar toda a UI. Repositório ativo e não arquivado. |
| [livekit/client-sdk-js](https://github.com/livekit/client-sdk-js) | Apache-2.0 | **Usado.** Captura de câmera/microfone/tela, adaptive stream, dynacast, qualidade de conexão, reconexão e data channels. Permite priorizar texto na captura com `contentHint: 'text'`. |
| [livekit/components-js](https://github.com/livekit/components-js) | Apache-2.0 | **Usado.** Hooks de participantes/tracks, `LiveKitRoom`, `VideoTrack` e reprodução de áudio. A interface é própria; não precisamos usar um layout pronto de reunião. |
| [versatica/mediasoup](https://github.com/versatica/mediasoup) | ISC | Excelente SFU de baixo nível e com controle fino. Exige construir sinalização, lifecycle de salas, reconexão, tokens, clientes e operação. Aumentaria muito o trabalho para esta primeira turma. |
| [jitsi/jitsi-meet](https://github.com/jitsi/jitsi-meet) | Apache-2.0 | Bom para incorporar uma reunião pronta. Menos adequado para integrar profundamente canais, amizades, notas, ferramentas sobre a tela e visual próprio. Self-host envolve mais componentes. |
| [feross/simple-peer](https://github.com/feross/simple-peer) | MIT (confirmar na versão adotada se utilizado) | Útil para conexões P2P pequenas, mas não elimina sinalização/TURN e não resolve distribuição de uma apresentação para vários alunos. Não usado. |

A decisão considera a arquitetura, e não apenas estrelas. LiveKit, mediasoup e Jitsi estavam ativos na consulta. A evidência prática da integração usa as versões resolvidas no `package-lock.json`. O SDK cliente foi resolvido em `2.23.0`, componentes React em `2.9.25` e o SDK de servidor da Edge Function foi fixado em `2.19.2`.

### Full HD e imagens

- **Imagem enviada no chat:** upload direto do arquivo original. Sem compressão ou redimensionamento por canvas. Download por URL assinada, sujeito à RLS.
- **Imagem em movimento / tela:** captura WebRTC com alvo de 1920×1080, 30 fps, `contentHint: 'text'` e preset de encoding do LiveKit. É vídeo comprimido; não é transmissão lossless do arquivo.
- **Vários alunos:** o publicador envia ao SFU; ele distribui aos inscritos. Isso evita multiplicar uma conexão direta do professor para cada aluno.
- **Qualidade:** depende de banda, codecs, hardware, conteúdo e navegador. Não se deve prometer “1080p garantido” ou perda zero.
- **Áudio da tela:** o navegador decide quais fontes podem capturar áudio. Compartilhar uma aba Chromium geralmente oferece melhor suporte.
- **Mobile:** assistir e conversar é suportado; iniciar captura de tela depende do navegador/plataforma.

Referências:

- [Opções de screen share do SDK](https://docs.livekit.io/reference/client-sdk-js/interfaces/ScreenShareCaptureOptions.html)
- [Compartilhamento de tela](https://docs.livekit.io/home/client/tracks/screenshare/)
- [Deploy de LiveKit](https://docs.livekit.io/home/self-hosting/deployment/)
- [Tokens e grants](https://docs.livekit.io/home/get-started/authentication/)

## Ferramentas para aula e colaboração

| Biblioteca / projeto | Licença consultada | Adequação e decisão |
| --- | --- | --- |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | MIT | Melhor candidato para uma próxima etapa de **quadro infinito**: desenho, setas, formas, texto, diagramas e exportação. O pacote do editor não fornece automaticamente uma sala multiplayer pronta; autenticação, sincronização e persistência precisam de integração própria. |
| [tldraw/tldraw](https://github.com/tldraw/tldraw) | Licença própria tldraw | Ótima experiência de canvas e SDK de sincronização. O arquivo `LICENSE.md` consultado distingue desenvolvimento e produção e exige atenção à licença/chave para produção. Não tratar como MIT gratuito para qualquer produto. Não adotado. |
| [yjs/yjs](https://github.com/yjs/yjs) | MIT, confirmado no arquivo LICENSE | CRDT consolidado para edição simultânea e reconciliação offline. Bom candidato se as notas passarem a ter vários editores ao mesmo tempo. Adiciona transporte, persistência e gestão de documentos que não são necessários para notas publicadas pela equipe nesta versão. |
| [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Core MIT | Editor rico, baseado em ProseMirror, com integração Yjs. Recursos pagos/cloud devem ser avaliados separadamente do core. Faz sentido para cadernos ricos na etapa seguinte. |
| [supabase-community/y-supabase](https://github.com/supabase-community/y-supabase) | MIT | Provider Yjs por Supabase Realtime. Promissor para manter a arquitetura sem outro backend, mas pequeno e com última atividade registrada em junho de 2026 na consulta. Exigiria revisão de canais privados, RLS, persistência, concorrência e comportamento offline antes de adoção. |
| [partykit/partykit-text-editor-example](https://github.com/partykit/partykit-text-editor-example) | Exemplo de integração | Mostra Tiptap + Yjs + Supabase, porém introduz PartyKit como serviço. Útil como referência, sem justificar outro provedor nesta entrega. |

A implementação inicial usa **SVG sobre a área real do vídeo**, com coordenadas normalizadas, mantendo alinhamento entre telas de tamanhos diferentes. Cada desenho é enviado de forma confiável; ponteiros usam pacotes transitórios limitados para reduzir atraso. Pacotes recebidos têm limites de tamanho e validação de coordenadas. A identidade usada para autoria vem do participante autenticado pelo LiveKit.

As notas são outro recurso: persistem no Postgres, só a equipe edita, a turma recebe updates por Realtime. Atualizações verificam a versão anterior e recusam sobrescrita concorrente silenciosa. Isso atende o registro da aula sem afirmar que existe edição colaborativa CRDT.

## Interface, conteúdo e autenticação

- [supabase/supabase-js](https://github.com/supabase/supabase-js): SDK oficial para Auth, dados, Storage e Realtime. Autorização feita no banco, nunca apenas por esconder botões.
- [remarkjs/react-markdown](https://github.com/remarkjs/react-markdown) + [remarkjs/remark-gfm](https://github.com/remarkjs/remark-gfm): mensagens/notas com código, listas e tabelas. HTML bruto não é habilitado. Imagens externas em Markdown não são carregadas automaticamente; os anexos usam o Storage privado.
- [lucide-icons/lucide](https://github.com/lucide-icons/lucide): ícones consistentes sem carregar fontes de ícones.
- [emilkowalski/sonner](https://github.com/emilkowalski/sonner): feedback de ações e erros, sem modais bloqueantes para operações comuns.
- [marsidev/react-turnstile](https://github.com/marsidev/react-turnstile): MIT; integração React para o CAPTCHA já exigido no Supabase compartilhado. Tokens entram em `signUp`, `signInWithPassword` e `resetPasswordForEmail`; o widget é reiniciado após cada envio.

Referência de CAPTCHA: [Supabase Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha).

## Escopo e evolução

Antes de ampliar para uma comunidade pública: moderação com remoção da sala via API LiveKit, convites revogáveis na UI, bloqueio de usuários, cotas de arquivos, limitação de envio por conta, histórico/auditoria, retenção e notificações. Para a aula: quadro Excalidraw persistente, enquetes e gravação são próximas extensões possíveis.

Licenças e condições comerciais podem mudar. A versão em uso deve seguir o lockfile e as licenças distribuídas com os pacotes; a pesquisa descreve a decisão desta implementação.
