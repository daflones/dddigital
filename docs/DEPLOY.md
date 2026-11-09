# Deploy no Easypanel e Supabase

## 1. Estado do projeto original

- Repositório: `daflones/dddigital`, branch `main`.
- Supabase: `ruisoxcbuiuktffsqcro`, o mesmo usado pelo fsociety.
- Baseline `ddtal_` aplicado e permissões validadas em transação com rollback.
- Bucket privado `ddtal-attachments` criado; limite de 20 MB e tipos de arquivo restritos.
- Edge Functions `ddtal-livekit-token` e `ddtal-moderate-voice` publicadas.
- Google e e-mail já estavam habilitados no Auth compartilhado.
- CAPTCHA Turnstile já estava habilitado e foi preservado.
- URLs locais `http://localhost:5173/**` e `http://127.0.0.1:5173/**` acrescentadas à allowlist. As URLs existentes e o Site URL do SeekerAI foram preservados.
- Domínio de produção definido: `https://discodigital.daforja.com.br`. O DNS já aponta para a Cloudflare; o hostname responde quando o Easypanel associar a origem e emitir o certificado.
- Redirect `https://discodigital.daforja.com.br/**` já acrescentado ao Supabase Auth e `DDTAL_ALLOWED_ORIGINS` já inclui o domínio de produção nas secrets das Edge Functions.
- Credenciais LiveKit Cloud configuradas (`wss://fsociety-6fl48hgp.livekit.cloud`); token JWT validado em produção.
- Cargos (`ddtal_roles` + `ddtal_member_roles`) com permissões por cargo: moderar voz, gerenciar canais/cargos/convites, expulsar membros e editar notas.
- Moderação de voz via `ddtal-moderate-voice` (LiveKit Server API): silenciar, devolver voz, expulsar da sala e mover entre canais.
- Painel flutuante (document Picture-in-Picture) com controles e prévia da transmissão ao compartilhar a tela.
- Build local e Docker/Nginx validados. Testes com duas contas verificaram Realtime, anexos originais, notas, amigos e conversas privadas. Um SFU LiveKit local validou voz, vídeo, transmissão sintética, ponteiro, desenhos e mão levantada; a transmissão entre redes e os fluxos CAPTCHA/Google do domínio final continuam pendentes.

## 2. Frontend no Easypanel

1. Crie um serviço **App**.
2. Selecione a fonte GitHub: `https://github.com/daflones/dddigital`, branch `main`. Autorize o Easypanel a ler o repositório se ele for privado.
3. Escolha **Dockerfile**, caminho `Dockerfile`, contexto na raiz.
4. Configure os argumentos de build:

   ```dotenv
   VITE_SUPABASE_URL=https://ruisoxcbuiuktffsqcro.supabase.co
   VITE_SUPABASE_ANON_KEY=<chave publishable ou anon do projeto>
   VITE_TURNSTILE_SITE_KEY=<site key pública do widget já usado no projeto>
   VITE_GIPHY_API_KEY=<opcional — habilita a busca de GIFs no chat, avatar e ícone do servidor>
   ```

   O Dockerfile declara esses `ARG`. Não basta definir variáveis no container depois de compilar: confira se a configuração do Easypanel as entrega ao build. No Easypanel, essas variáveis geralmente ficam na aba **Environment** do app — certifique-se de que o campo esteja marcado como **build arg / deploy-time**; senão edite o Dockerfile para embutir os valores ou use `ENV` durante o build.

5. Porta interna: **80**. Healthcheck HTTP: **`/health`** (o Dockerfile já declara `HEALTHCHECK`; configure o healthcheck do Easypanel também se quiser verificação externa).
6. Adicione o domínio **`discodigital.daforja.com.br`** ao app no Easypanel (aba Domains) e habilite HTTPS/Let's Encrypt. O DNS já está na Cloudflare — confira se o proxy não impede o ACME; em caso de erro de certificado, desative temporariamente o proxy (nuvem cinza) ou use validação DNS.
7. Faça o deploy e ative o rebuild automático em pushes na branch `main`.

O container não guarda arquivos, banco ou segredos administrativos. Nginx fornece fallback da SPA, cache dos assets com hash, headers de proteção e CSP compatível com Supabase, LiveKit e Turnstile. Os hosts HTTPS/WSS de conexão são amplos porque o endpoint de mídia é configurável; podem ser restringidos ao domínio LiveKit escolhido.

Validação local do mesmo container:

```sh
node scripts/docker-build.mjs
docker run --rm -p 8080:80 ddtal-web:local
```

## 3. Autenticação no domínio definitivo

Já configurado no Supabase → Authentication → URL Configuration:

```text
https://discodigital.daforja.com.br/**
```

Não substitua o Site URL do SeekerAI nem apague os redirects existentes. O aplicativo passa `redirectTo` explicitamente, inclusive nos convites e na recuperação de senha.

**Pendente manual:** no Cloudflare → Turnstile, autorize o hostname `discodigital.daforja.com.br` no widget correspondente à site key pública usada no build. A secret key já configurada no Supabase precisa corresponder a esse widget. Não desative a proteção para fazer o login funcionar — sem o hostname no widget, login por senha/cadastro/recuperação exibirá erro de CAPTCHA; o login Google continuará funcionando.

O provedor Google já está habilitado no Supabase. Seu callback do Google continua sendo:

```text
https://ruisoxcbuiuktffsqcro.supabase.co/auth/v1/callback
```

O app usa PKCE e preserva `?invite=...` no retorno. Confirme cadastro, senha, recuperação, Google e abertura de convite em uma janela anônima no domínio final. Dependendo da configuração de confirmação de e-mail do projeto, o usuário pode precisar confirmar antes de entrar.

## 4. LiveKit

### Opção recomendada: LiveKit Cloud

Crie um projeto LiveKit e obtenha a URL WebSocket, API key e API secret. As credenciais privadas ficam **somente** nos secrets das Edge Functions:

```dotenv
DDTAL_LIVEKIT_URL=wss://SEU-PROJETO.livekit.cloud
DDTAL_LIVEKIT_API_KEY=<api key>
DDTAL_LIVEKIT_API_SECRET=<api secret>
DDTAL_ALLOWED_ORIGINS=https://discodigital.daforja.com.br,http://localhost:5173,http://127.0.0.1:5173
```

Não inclua barras finais nas origens. CORS compara a origem exata. Acrescente outros domínios explicitamente, se forem usados.

É possível configurar pelo Dashboard do Supabase ou por um arquivo local ignorado `.env.livekit`:

```sh
supabase secrets set --env-file .env.livekit --project-ref ruisoxcbuiuktffsqcro
supabase functions deploy ddtal-livekit-token --project-ref ruisoxcbuiuktffsqcro --use-api
supabase functions deploy ddtal-moderate-voice --project-ref ruisoxcbuiuktffsqcro --use-api
```

A CLI pode pedir confirmação. `--yes` é aceito para execução já autorizada em automações. Faça deploy **somente da função nomeada** para não mexer nas funções dos outros projetos.

Sem os secrets LiveKit, a função devolve 503 com uma mensagem clara; chat e demais recursos continuam disponíveis. O cliente não mostra uma chamada fictícia como se estivesse conectado.

Custos de LiveKit dependem de tráfego e minutos de participantes; verifique o plano atual no provedor. O uso de Supabase Realtime, Storage e egress também entra nas cotas do projeto compartilhado.

### Alternativa: hospedar LiveKit

É necessário um serviço separado do frontend. O proxy HTTP do Easypanel não substitui os requisitos de rede do WebRTC:

- Sinalização HTTPS/WSS.
- RTC por UDP, com faixa ou porta multiplexada.
- TCP de fallback e TURN/TLS para redes restritas.
- IP público correto anunciado aos clientes.
- Certificados e DNS do serviço de mídia.

Use a documentação oficial de deploy do LiveKit. Não coloque API secret no bundle e não use as chaves de desenvolvimento em produção.

## 5. Primeira turma

1. Entre com sua conta e ajuste nome e identificador em **Meu perfil**.
2. Crie o servidor `F.dev • Builders`.
3. Use **Convide sua comunidade** para gerar o link.
4. Compartilhe o link com os alunos. Novos membros entram com papel `member`; o criador tem papel `owner`.
5. Na aba **Pessoas**, use **Gerenciar cargos** para criar cargos (ex.: `Mr Robot`) e atribuir no menu de cada membro.
6. Abra **Sala de aula**, entre na chamada e ative o microfone.
7. Compartilhe a tela. Para áudio do computador, prefira compartilhar uma aba e marque a opção de compartilhar áudio no seletor do navegador, quando disponível.
8. Use **Chat** para dúvidas e imagens, **Notas** para o registro da aula e os controles sobre a transmissão para apontar/desenhar.
9. Ao compartilhar, o painel flutuante abre sobre a tela (Chrome/Edge) com microfone, câmera, lista de participantes e prévia da transmissão. Para moderar um aluno, passe o mouse sobre o card dele: silenciar, devolver voz, mover para outra sala ou expulsar.

Amigos são encontrados por identificador, não por e-mail. O aceite libera a conversa privada e a sala de chamada dos dois. Não há ainda notificação de chamada recebida: o outro participante precisa abrir a conversa e entrar.

## 6. Verificação antes de uma aula

- Faça uma chamada entre dois dispositivos em redes diferentes, incluindo rede móvel, para validar NAT/TURN e reconexão.
- Compartilhe um editor com texto pequeno. Teste em Chrome/Edge e no navegador real dos alunos. A solicitação é 1920×1080/30, mas a resolução efetiva depende da captura, viewport, capacidade do aparelho e banda.
- Teste permissão negada, parar captura pelo navegador, mutar/desmutar e sair.
- Confirme que aluno sem convite não acessa mensagens, arquivos ou tokens de outro servidor.
- Teste upload da imagem original e uma aula com o número previsto de alunos; meça egress e estabilidade.

As contas são compartilhadas com o Supabase do fsociety/SeekerAI. Alterações globais de Auth, SMTP, CAPTCHA e limites afetam os demais aplicativos. Novas tabelas, políticas, funções e buckets do Discodigital devem continuar identificados por `ddtal`.

## Limitações desta entrega

- Notas têm edição pela equipe com controle de versão; não são um editor CRDT com digitação simultânea.
- As marcações não são gravadas nem reproduzidas para quem entra depois.
- Não há gravação/transcrição, quadro infinito, notificações push, presença global ou contador real de dias da turma.
- Tokens de sala expiram em 15 minutos para novas conexões; participantes conectados continuam até saírem ou serem removidos pela moderação.
- O painel flutuante usa a API document Picture-in-Picture, disponível no Chrome/Edge. Em outros navegadores os controles continuam na janela principal.
- Mudança de permissões, cotas, limites de envio e políticas de retenção devem ser planejadas antes de ampliar o uso para uma comunidade pública grande.
