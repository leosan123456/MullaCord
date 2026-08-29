# Arquitetura do Mulacord

## Visão geral

```
┌─────────────┐   REST (contas, histórico)   ┌────────────────────┐
│  App        │ ───────────────────────────▶ │  Servidor (host)   │
│  Electron   │                              │  FastAPI + SQLite  │
│  (renderer) │ ◀──── WebSocket /gateway ───▶ │  (self-hosted)     │
└─────────────┘   eventos em tempo real       └────────────────────┘
       │                                              │
       │   mídia P2P (voz + tela) — WebRTC             │ só faz signaling
       └──────────────────────────────────────────────┘
```

- **Servidor**: cada pessoa roda o seu (`server/`). Guarda contas, amizades, canais e
  mensagens num arquivo SQLite (`server/data/mulacord.sqlite3`). Sem serviço em nuvem.
- **App**: Electron. O `renderer` fala REST + WebSocket; o `main process` só cuida de
  janela e da captura de tela (`desktopCapturer`).
- **Voz/tela**: WebRTC em malha (mesh). O servidor apenas repassa SDP/ICE entre os
  pares. A mídia trafega direto de um cliente para o outro. Bom até ~4-5 pessoas por
  call; acima disso vale migrar para um SFU.

## Conectividade e descoberta

Cada pessoa hospeda o próprio backend (porta `8787`). O app se conecta a um servidor
assim:

- **Descoberta na LAN** — responder UDP em `0.0.0.0:8788` (`discovery.py`). O app
  (Electron `main.js`, via `dgram`) faz broadcast de `MULACORD_DISCOVER <nonce>` e
  lista os servidores que respondem (nome, IP, nº de membros, `server_id`).
- **Servidores conhecidos** — o app guarda `[{url, name, server_id, token}]` em
  `localStorage['mula.servers']`; a sessão salva reconecta sem pedir senha.
- **Link `mula://host:porta`** — registrado como protocolo (`setAsDefaultProtocolClient`);
  clicar num link abre o app já apontando pro servidor. `mula://` ↔ `http://`.
- **Modo host** — o app sobe/mata o servidor local (bundlado ou `run.py` em dev) via
  IPC (`window.mula.host`), mostra os links compartilháveis (127.0.0.1 + cada IP de LAN)
  e o log ao vivo.
- **Latência** — o heartbeat do gateway ecoa o timestamp do cliente; o app mostra o RTT.
- **Reconexão** — backoff exponencial (1s→15s) + botão "tentar agora".

De fora da LAN ainda é preciso port forwarding no roteador do host (o link vira
`mula://<ip-público>:8787`). STUN público (Google) ajuda o WebRTC; sem TURN, NAT
simétrico pode falhar (fase futura).

`GET /api/info` → `{ server_id, name, version, members, open_registration, discovery_port }`.

## Esquema de dados (SQLite)

| Tabela | Campos principais |
|---|---|
| `users` | id, username, email, password_hash (pbkdf2), display_name |
| `friendships` | requester_id, addressee_id, status (`pending`/`accepted`) |
| `guilds` | id, name, icon, owner_id |
| `guild_members` | guild_id, user_id, nickname |
| `roles` | id, guild_id, name, color, **permissions** (bitfield), position, hoist, mentionable, is_default |
| `member_roles` | guild_id, user_id, role_id |
| `categories` | id, guild_id, name, position |
| `channels` | id, type (`dm`/`group`/`text`/`voice`), name, topic, owner_id, **guild_id**, category_id, position |
| `channel_members` | channel_id, user_id — **só para dm/group** |
| `channel_overwrites` | channel_id, target_type (`role`/`member`), target_id, **allow**, **deny** |
| `invites` | code, guild_id, creator_id, uses, max_uses, expires_at |
| `messages` | id, channel_id, author_id, content, edited_at, created_at |
| `attachments` | id (token), message_id (null até enviar), channel_id, uploader_id, filename, stored_name, content_type, size, width, height, kind (`image`/`video`) |

- **DM**: canal `dm` com 2 membros, criado sob demanda entre amigos (usa `channel_members`).
- **Servidor (guild)**: um backend hospeda vários. Ao criar, ganha `@everyone` +
  categoria "Geral" + `#geral` + `🔊 Voz Geral`. Entrada por código de convite.
- **Acesso a canal de guild** vem 100% das permissões — não de `channel_members`.

## Permissões (estilo Discord)

Bitfield de 20 flags em `permissions.py` (espelhado em `desktop/src/permissions.js`).
`GET /api/permissions` devolve o mapa nome→bit.

Cálculo (`guilds_service.channel_perms`):

1. Dono do servidor → todas as permissões.
2. `base` = OR de `@everyone` + todos os cargos do membro. Tem `ADMINISTRATOR` → todas.
3. Overwrites do canal, na ordem do Discord: `@everyone` (deny→allow) → soma dos
   overwrites de cargo do membro (deny→allow) → overwrite do próprio membro (deny→allow).
4. Sem `VIEW_CHANNEL` no resultado ⇒ canal invisível (some da sidebar, history dá 403).

O servidor **aplica** em toda rota/gateway; o cliente **recalcula** só para mostrar/esconder UI.
Ao criar/editar cargo, não se pode conceder permissão que o próprio autor não tem (salvo dono/admin).
Hierarquia: só mexe em cargo/membro de posição abaixo da sua (salvo dono).

## Autenticação

- Senha: PBKDF2-SHA256 (240k rounds), stdlib. Sem dependência de hashing nativa.
- Token: JWT HS256, segredo em `server/data/.secret_key` (gerado no 1º boot).
- REST: header `Authorization: Bearer <token>`.
- Gateway: primeira mensagem `{"op":"identify","token":"<token>"}`.

## Protocolo do gateway (WebSocket `/gateway`, JSON)

### Cliente → servidor (`op`)

| op | payload | efeito |
|---|---|---|
| `identify` | `token` | autentica a conexão (obrigatório, primeiro) |
| `heartbeat` | — | keep-alive (responde `heartbeat_ack`) |
| `send_message` | `channel_id`, `content`, `attachment_ids?` | cria mensagem (checa `SEND_MESSAGES`) |
| `typing` | `channel_id` | avisa "digitando" |

> Editar/apagar mensagem e editar perfil são só REST (`PATCH`/`DELETE
> /api/channels/{c}/messages/{m}`, `PATCH /api/auth/me`); o servidor emite o
> evento correspondente pelo gateway.

O `heartbeat` do cliente leva `ts` (timestamp); o `heartbeat_ack` devolve o mesmo
`ts` pro app medir latência.

## Anexos (imagens e vídeos)

Fluxo em 2 passos: `POST /api/channels/{c}/attachments` (multipart, checa
`ATTACH_FILES`, só `image/*` e `video/*`, ≤50 MB, ≤10 por mensagem) grava em
`server/data/uploads/<token><ext>` e devolve `[{id, url, width, height, kind, …}]`
com `message_id` nulo. Aí o `send_message` (gateway ou REST) manda `attachment_ids`
e o servidor vincula os que forem do próprio autor, do mesmo canal e ainda soltos.
`GET /api/attachments/{id}/{filename}?t=<jwt>` serve o arquivo (o `?t=` existe porque
`<img>`/`<video>` não mandam header; checa `VIEW_CHANNEL`). Dimensão de imagem é lida
do cabeçalho em `media.py` (PNG/JPEG/GIF/WebP/BMP, sem Pillow). Apagar a mensagem
apaga os arquivos. Cliente: botão de clipe, arrastar-soltar e colar (Ctrl+V);
grade de miniaturas na mensagem + lightbox com navegação.
| `rtc_join` | `channel_id` | entra no canal de voz (checa `CONNECT`; 1 por guild) |
| `rtc_leave` | `channel_id` | sai da call |
| `rtc_signal` | `channel_id`, `to_user_id`, `data` | repassa SDP/ICE opaco a um peer |

### Servidor → cliente (`t`)

| t | payload |
|---|---|
| `ready` | `user`, `channels[]` (dm/group), `friends[]`, `guilds[]`, `voice_states[]`, `online[]` |
| `message_create` | `message` — só para quem enxerga o canal |
| `message_update` | `message` (com `edited_at`) |
| `message_delete` | `channel_id`, `message_id` |
| `user_update` | `user` (nome/avatar) — para amigos e co-membros |
| `typing` | `channel_id`, `user_id` |
| `presence` | `user_id`, `status` (`online`/`offline`) |
| `channel_create` / `channel_update` / `channel_delete` | `channel` (com `guild_id` se for de servidor) |
| `friend_request` / `friend_accepted` | `user` |
| `guild_create` / `guild_update` | `guild` (objeto completo: roles, canais, categorias, membros) |
| `guild_delete` | `guild_id` |
| `guild_member_add` / `guild_member_remove` | `guild_id`, `member`/`user_id` |
| `guild_member_update` | `guild_id`, `user_id`, `role_ids?`, `nickname?` |
| `voice_state_update` | `guild_id`, `channel_id` (null = saiu), `user_id` |
| `rtc_peers` | `channel_id`, `user_ids[]` (quem já estava na call) |
| `rtc_peer_join` / `rtc_peer_leave` | `channel_id`, `user_id` |
| `rtc_signal` | `channel_id`, `from_user_id`, `data` |
| `error` | `message` |

## Handshake WebRTC (mesh)

1. Cliente entra: `rtc_join` → recebe `rtc_peers` com quem já está.
2. Para cada par, **quem tem o maior `user_id` cria a offer** (evita glare).
3. `rtc_signal` carrega `{kind:"sdp", sdp}` ou `{kind:"candidate", candidate}`.
4. Tela: adiciona `getDisplayMedia` track às conexões existentes e renegocia.

## Frontend — marca "Mulla Cord"

Preto absoluto `#09090B` · amarelo `#FACC15` (ouro `#EAB306`, claro `#FDE047`) ·
fonte **Satoshi** (bundlada em `src/fonts/*.woff2`) · tagline *"Your community, in tune"* ·
elementos de marca CHAT / VOICE / COMMUNITY / LIVE · grafismos de ondas de áudio
com nós de conexão (`.brand-wave`). O logo (cabeça no balão de fala) não muda de
geometria — só recolore.

- `styles.css` — sistema de tokens. `--accent` é a base única; hover/press/soft/ring
  derivam via `color-mix`. `store.applyUi()` sobrescreve os tokens conforme
  `localStorage['mula.ui']` = `{ theme, accent, bg, parallax, anim, compact }`.
- **Personalização** (modal de perfil): tema claro/escuro, cor de destaque
  (presets + cor customizada, contraste do texto calculado por luminância),
  fundo (gradiente / aurora / sólido), parallax on/off, animações on/off, modo compacto.
- **Tela de loading** (`#splash`): logo flutuante, wordmark com brilho, barra de
  scan, blobs em gradiente e onda de áudio. Some após ≥1,5 s + fade.
- **Fundo em gradiente + parallax**: `.bg-fx` com 3 blobs à deriva; no login o
  mousemove desloca os blobs e o card (`--px`/`--py` em `:root`).
- **Janela sem moldura** (`frame:false`); barra de título própria via `window.mula.win`.
- `icons.js` — ícones SVG inline (estilo Lucide) + `hydrateIcons()`.
- Animações, toasts (`store.toast`), skeleton, indicador de conexão + latência.

## Controles de áudio (cliente)

`audio.js` guarda as preferências por dispositivo no `localStorage`
(`mula.audio`): microfone, saída, modo, sensibilidade, tecla de PTT, filtros,
volume por pessoa. `rtc.js` (`VoiceSession`) aplica em tempo real:

- **Entrada/saída**: `getUserMedia({audio:{deviceId}})` + `sender.replaceTrack`;
  `audioEl.setSinkId` nos elementos de reprodução (um `<audio>` oculto por par).
- **Modo de transmissão**: `open` (sempre), `vad` (gate por RMS de um
  `AnalyserNode`, com limiar ajustável) ou `ptt` (tecla configurável).
- **Mudo / ensurdecer**: `track.enabled` + `audioEl.volume`. Ensurdecer também muta.
- **Volume por pessoa**: slider → `audioEl.volume` (0..1).
- Painel de configurações (`settings.js`) com medidor de nível ao vivo.

## Empacotamento

- **Servidor** → PyInstaller (`server/mulacord-server.spec`, onedir):
  `py -m PyInstaller mulacord-server.spec --noconfirm` → `server/dist/mulacord-server/`.
  Quando "frozen", os dados vão pra `%APPDATA%/Mulacord/server`.
  Registro de conta: `email` é opcional (gera um sintético `<user>@mulacord.local`
  escondido nas respostas); senha mínima de 6 caracteres.
- **App** → electron-builder (`desktop/package.json` campo `build`), alvo NSIS.
  `productName: "Mulla Cord"`, `executableName: "MullaCord"`. `extraResources`
  bundla `server/dist/mulacord-server` em `resources/server/`.
  `npm run dist` = `build:server` (PyInstaller) + `scripts/postbuild.js`
  (`png-to-ico` → `build/icon.ico`) + `electron-builder --win`. Saída:
  `desktop/dist-installer/Mulla Cord Setup <versão>.exe`.
- **Ícone**: `signAndEditExecutable:false` (o cache `winCodeSign` precisa do Modo
  de Desenvolvedor do Windows para os symlinks) — o `.exe` fica com o ícone padrão
  do Electron, mas `build/installer.nsh` (`customInstall`) copia o `icon.ico` para
  a pasta de instalação e cria os atalhos da área de trabalho e do menu Iniciar
  ("Mulla Cord") apontando `IconLocation` para ele.
- O app instalado sobe o servidor bundlado no modo host (`resources/server/mulacord-server.exe`).

## Fases

1. Contas, amigos, DMs, grupos, chat realtime, voz + tela P2P. ✅
2. Servidores (guilds): canais de texto/voz, categorias, convites, lista de membros,
   **permissões completas** (bitfield, hierarquia de cargos, overwrites por canal). ✅
3. Controles de áudio completos, editor visual de overwrites, editar/apagar mensagem
   + menções, perfil + avatar. ✅
4. Frontend com identidade própria (âmbar, claro/escuro, janela sem moldura, ícones SVG). ✅
5. Descoberta LAN + servidores conhecidos + link `mula://` + modo host + latência;
   instalador NSIS com app + servidor bundlado. ✅
6. Anexos de arquivo (`server/data/uploads/`), reordenar canais (drag), banir membros.
7. TURN embutido (`aiortc` ou `coturn`) para NAT simétrico; relay de rendezvous.
8. Migração opcional para SFU quando calls passarem de ~5 pessoas.

> **Migração de banco**: a fase 2 mudou o schema. Bancos da fase 1 não migram
> automaticamente — apague `server/data/mulacord.sqlite3*` e recomece.
