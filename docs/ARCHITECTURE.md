# Arquitetura do Mulla Cord

## Visão geral — enxame de réplicas

```
   PC da Ana                 PC do Beto                PC "semente" (bandeja)
┌─────────────┐           ┌─────────────┐            ┌─────────────┐
│ app + nó A  │◀── sync ─▶│ app + nó B  │◀── sync ──▶│    nó C     │
│ SQLite (⟳)  │   gossip   │ SQLite (⟳)  │   gossip    │ SQLite (⟳)  │
└─────────────┘           └─────────────┘            └─────────────┘
   ▲ cliente local            ▲ cliente local
```

- **Sem nuvem, sem "hospedar"**: quando o app abre, ele sobe um **nó** em segundo
  plano (`main.js` → `startHost()` no `whenReady`). O cliente fala sempre com o
  **nó local** (`127.0.0.1:8787`) — leitura instantânea.
- **Comunidade**: um grupo lógico de nós que compartilham tudo, identificado por
  `community_id` (+ segredo opcional). O Electron guarda a comunidade atual em
  `userData/community.json`; cada comunidade tem seu próprio data dir
  (`userData/communities/<id>/`).
- **Réplica completa**: todo nó tem contas, amigos, canais, cargos, mensagens e
  anexos inteiros. Os nós trocam um log de operações entre si e o estado converge.
- **Coordenador** (só pra quem o cliente conecta quando o nó local ainda não
  sincronizou): eleito por `(node_priority desc, started_at asc, node_id asc)`.
- **Voz/tela**: WebRTC em malha (mesh). O nó só repassa SDP/ICE. Bom até ~4-5 por call.

## Conectividade e descoberta

- **Nó local sempre no ar** — sobe no launch; fica vivo na bandeja se
  "Manter no ar em segundo plano" estiver ligado (semente do enxame).
- **Descoberta na LAN** — responder UDP em `0.0.0.0:8788` (`discovery.py`); o beacon
  leva `community_id`, `community_name`, `node_priority`, `started_at`, `public_host`.
  O Electron (`dgram`) faz broadcast de `MULACORD_DISCOVER <nonce>`.
- **Primeiro uso** (`#auth-welcome`): criar comunidade / entrar numa achada na LAN /
  colar convite `mula://join/<base64url(json)>` (`{id,name,secret,addrs}`).
- **Sessão** — salva por comunidade em `localStorage['mula.session.<id>']`
  `{token, url}`; token é assinado com a chave da comunidade, então vale em qualquer nó.
- **UPnP** (best-effort, sem dependência) — `main.js` faz SSDP + SOAP `AddPortMapping`
  no roteador; se der certo, grava `publicHost` = `<ip-externo>:8787` e reinicia o nó.
- **Peers de partida** — `MULACORD_BOOTSTRAP_PEERS` (convite + `publicHost` + IPs de
  LAN da mesma comunidade); depois os nós aprendem peers-de-peers pela `/sync`.
- **Reconexão** — backoff exponencial (1s→15s) + botão "tentar agora"; após entrar
  por um peer, `migrateToLocalWhenReady()` troca pro nó local quando ele sincroniza.

`GET /api/info` → `{ service, server_id, node_id, name, version, members,
open_registration, discovery_port, community_id, community_name, node_priority,
started_at, public_host }`.

## Replicação em enxame (`replication.py`)

**Log de operações (`oplog`)** — na `setup()` o nó cria (recriando a cada boot, com
o `NODE_ID` embutido) triggers `AFTER INSERT/UPDATE/DELETE` em cada tabela
sincronizável. Cada trigger grava uma linha no `oplog`
`{origin, lamport, table_name, op, pk (json), data (json da linha), ts_ms}`.
Um guard (`repl_meta.apply_guard`) desliga os triggers durante o *apply*.

**IDs por faixa de nó** — não dá pra usar `AUTOINCREMENT` (depois que uma linha de
id alto de outro nó replica, `MAX(rowid)` local "pula" e colide). `next_id()` =
`_node_band()` (hash do nó → 1 de ~500k faixas × 100M) + contador compartilhado
(`repl_meta.idcounter`, atômico via `UPDATE … RETURNING`). Todo `INSERT` passa `id`
explícito. Id máx ~5e13, abaixo do limite seguro do JS (2^53).

**Sincronização** — bidirecional, `POST /api/replica/sync`
`{since:{origin→lamport}, self, peers}` → `{events, vector, peers, community}`,
a cada ~8 s (`_gossip_loop`). Caminho rápido: `_push_loop` varre eventos locais
novos a cada 0,5 s e faz `POST /api/replica/push` pros peers. Auth: header
`X-Comm-Key` = `config.COMMUNITY_KEY` (HMAC do `community_id` com o segredo).

**Apply (LWW)** — segura `db.write_lock` o lote inteiro (senão uma escrita local
escapa do oplog entre `await`s); ordena por `(ts_ms, origin, lamport)`; pra cada
evento: ignora duplicado, grava no oplog, e só **materializa** (upsert/delete na
tabela real) se for o evento mais novo daquela linha; 2 passadas extras cobrem
"filho antes do pai". Depois dispara os eventos de gateway
(`_dispatch_realtime`: `message_create/update/delete`, `friend_request/accepted`,
`channel_create` de DM, e um `guild_update` grosso por guild afetada).

**Compactação** — `_prune_oplog()` (a cada ~5 min) apaga eventos superados com mais
de 10 min: pra LWW basta 1 evento por linha (o mais novo) sobreviver.

**Cliente sempre local** — `community.js resolveActive()` prefere o nó local
(`127.0.0.1`); só usa um peer com `preferRemote:true` logo após entrar numa
comunidade, enquanto o nó local ainda enche.

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

- **Amigos**: `GET /api/users?q=` lista/busca as contas do servidor (menos você) com
  o `relationship` de cada uma (`none`/`outgoing`/`incoming`/`friend`) — é o
  diretório para achar quem adicionar. `POST /api/friends/request {username}` manda o
  pedido; o alvo recebe `friend_request` ao vivo e aceita em `POST /api/friends/{id}/accept`
  (o outro lado recebe `friend_accepted`).
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

- Senha: PBKDF2-SHA256 (240k rounds), stdlib. O hash replica como string — login
  funciona em qualquer nó.
- Token: JWT HS256 assinado com `config.TOKEN_KEY` = HMAC derivado do
  `community_id` + segredo (**não** do `.secret_key` por-nó) → um token vale em
  todos os nós da comunidade.
- REST: header `Authorization: Bearer <token>`.
- Gateway: primeira mensagem `{"op":"identify","token":"<token>"}`.
- Entre nós: header `X-Comm-Key` = `config.COMMUNITY_KEY` nas rotas `/api/replica/*`.

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

## Status de jogo

O `main.js` do Electron (`games.js`) roda `tasklist` a cada 18 s e compara os
processos com `electron/games.json` (~100 jogos) + a lista que o usuário adicionou
(`localStorage['mula.games']`). Quando um jogo entra/sai, manda por IPC pro
renderer, que envia `set_activity` `{name, started_at}` pelo gateway. O
`ConnectionManager` guarda a atividade em memória (some ao desconectar) e faz
`broadcast_user_scope`; o `ready` traz `activities` de quem o usuário vê. O cliente
mostra "🎮 Jogo · MM:SS" (timer que tica de 1 em 1 s) na lista de membros, na lista
de amigos e no painel do usuário. Dá pra desligar ou adicionar jogos manualmente
nas configurações de perfil.

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
| `set_activity` | `activity` (`{name, started_at}` ou `null`) | status de "jogando" |

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
| `activity` | `user_id`, `activity` (`{type:"playing", name, started_at}` ou `null`) |
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

## Bandeja / semente

`main.js` cria um `Tray`; `userData/prefs.json` guarda
`{ background, openAtLogin }`. Com `background` ligado, fechar a janela só
esconde (`win.on("close")` → `preventDefault` + `hide`) e `window-all-closed` não
mata o nó — o PC segue no enxame. `openAtLogin` usa
`app.setLoginItemSettings({ openAtLogin, args:["--background"] })`; com `--background`
o app sobe sem janela. IPC: `prefs:get` / `prefs:set` (`window.mula.prefs`).

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
6. Anexos de imagem/vídeo, status de jogo, marca "Mulla Cord" (Satoshi + amarelo). ✅
7. **Modelo de conexão v2**: nó local sempre no ar (sem "hospedar"), comunidade +
   descoberta LAN + coordenador eleito, primeiro uso criar/entrar. ✅ (v1.3)
8. **Enxame auto-alimentado**: oplog por triggers, gossip + push, IDs por faixa,
   token da comunidade, realtime na réplica, bandeja/semente, UPnP best-effort. ✅ (v1.3)
9. Barra de progresso ao entrar numa comunidade grande; relay de rendezvous +
   TURN embutido para NAT simétrico; SFU quando calls passarem de ~5 pessoas.

> **Migração**: bancos anteriores à 1.3 não têm oplog — o nó faz *backfill* no
> primeiro boot da 1.3. Em caso de estado estranho, apague o data dir da comunidade
> (`%APPDATA%/Mulla Cord/communities/<id>/`) e recomece.
