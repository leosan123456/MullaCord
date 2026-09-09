# Changelog

## 1.5.3

WebRTC (voz/tela) mais robusto + STUN/TURN configurável + correções de sync.

### Correções
- **"Convite inválido" ao entrar num servidor da mesma comunidade**: o convite
  (ou a conta de quem acabou de se cadastrar noutro nó) ainda não tinha
  replicado. Agora o nó faz um **sync na hora** quando não acha o convite/usuário
  e só recusa se ele realmente não existir. O cliente ainda re-tenta por ~15s
  ("Procurando o convite…"). Mensagem de erro mais clara.
- Convite do servidor: botão **Copiar código**.

### WebRTC

- **STUN**: 5 servidores do Google (era 2), `iceCandidatePoolSize`, `bundlePolicy`.
- **Auto-recuperação**: se a conexão de voz cai (troca de rede, NAT rebind), o
  app faz **ICE restart** sozinho em vez de deixar a chamada muda.
- **ICE servers por comunidade**: o nó serve a lista em `/api/info` (`ice_servers`).
  Campo em **Perfil → Comunidade → Servidores STUN/TURN** — cole um TURN (relay)
  próprio pra voz funcionar em NAT simétrico / rede corporativa / operadora móvel.
  Uma linha por servidor (`turn:host:3478 usuario senha`) ou um array JSON.
  Env equivalente: `MULACORD_ICE_SERVERS`.

## 1.5.2

Atualização automática.

- **Windows**: o app checa a Release do GitHub no launch e a cada 3h; se sair
  versão nova, baixa em segundo plano (pacote **diferencial** — só os blocos que
  mudaram) e **instala ao fechar o app**. Um aviso discreto no topo oferece
  "Reiniciar agora". `electron-updater` + `nsis-web`.
- **macOS**: por enquanto só **avisa** ("Mulla Cord X.Y.Z disponível → Baixar") e
  abre o `.dmg` — o auto-update do macOS exige assinatura da Apple.
- Bandeja: "Verificar atualizações" / "Reiniciar para atualizar".
- Desligável com `MULACORD_NO_UPDATER=1`; inativo em dev.
- A verificação de Authenticode do updater está **desligada** enquanto o projeto
  usa cert self-signed — a integridade fica pelo `sha512` do `latest.yml`.

> A partir desta versão as correções chegam sozinhas. Quem já tem 1.5.1 ou mais
> antigo precisa instalar a 1.5.2 uma vez.

## 1.5.1

Descoberta de pessoas na comunidade + entrada mais fácil.

### Nós se encontram de verdade
- **Firewall**: o nó escuta em 8787/TCP + 8788/UDP; se a entrada estiver
  bloqueada os apps se veem na descoberta mas não sincronizam. Agora:
  - o instalador tenta liberar (`netsh`, se rodar elevado);
  - o app **detecta** que a LAN não o alcança e mostra um banner
    **"Liberar no Firewall"** (roda `allow-firewall.ps1` com 1 UAC);
  - `desktop/scripts/allow-firewall.ps1` — script avulso, cria/remove as regras.
- **NIC errada**: `_own_address()` preferia a rota default (VMware/Hyper-V/WSL/VPN).
  Agora escolhe um IP de faixa "de casa" e o outro nó também anota o **IP de
  origem observado** — sempre o que realmente alcança.
- Gossip mais rápido nos primeiros ~30s (2s) pra quem entrou ver todo mundo logo.

### Escolha de nó no cliente
- `resolveActive`: se um peer alcançável tem **mais gente** que o nó local, usa o
  peer até o local emparelhar (antes voltava sempre pro local, mesmo vazio).
- `migrateToLocalWhenReady`: só migra pro nó local quando a **contagem de
  membros** bate, não só a própria conta.
- Busca de pessoas mostra "ainda sincronizando…" em vez de "você é a única conta".
- Barra lateral: dica **"sincronizando pessoas… 2/5"** enquanto o nó local pega o resto.

### Entrar em comunidade
- A tela de boas-vindas **varre a rede continuamente** (comunidade nova aparece sozinha).
- Botão **"← trocar de comunidade"** sempre visível.
- Na tela de credenciais, se aparecer **outra comunidade na rede**, um clique entra nela.

### `/api/replica/status`
- Agora traz `local_members` e os peers com `last_ok` — pra diagnóstico.

## 1.5.0

Instalador compacto + macOS + build no CI.

### Instalador (Windows)
- **Instalador-web**: o usuario baixa um stub de **~1 MB** (era ~92 MB); o app
  (~85 MB) vem durante a instalacao, da Release do GitHub. Mesma cara da marca,
  mesma instalacao sem admin em `%LOCALAPPDATA%`. Alvo `nsis` → `nsis-web`.
- **Portatil** continua offline, agora **~78 MB** (era ~92): `compression: maximum`,
  locales do Chromium podados (so `en-US` + `pt-BR`), servidor Python mais enxuto
  (sem watchfiles / PyYAML / tzdata), renderer ofuscado.
- Requisitos claros: **Windows 10 (1809+) e 11**, 64-bit.

### macOS
- Alvos `dmg` + `zip` para **arm64 (Apple Silicon)** e **x64 (Intel)**, macOS 11+.
- Hardened runtime + entitlements (`build/entitlements.mac.plist`): JIT, microfone,
  camera, rede. Usage strings de mic/camera no Info.plist.
- Assinatura **ad-hoc** por enquanto (sem Apple Developer ID) — Gatekeeper pede
  "botao direito → Abrir" na 1a vez. Passo a passo em `docs/INSTALL.md`.
- `npm run dist:mac`.

### Build no CI
- `.github/workflows/build.yml`: um push de tag `v*` builda Windows (`windows-latest`)
  e macOS (`macos-14`) e anexa **todos** os artefatos a Release da tag — de onde o
  instalador-web puxa o pacote. Cert de assinatura do Windows via secrets
  (`WIN_CSC_PFX_B64` / `WIN_CSC_PASSWORD`) ou efemero.
- `afterPack.js` agora e cross-platform (poda locales + Fuses no binario certo por
  plataforma; assina o servidor embutido so no Windows).

### Distribuicao
- Os instaladores **saem da pasta `releases/`** do repo (eram ~90 MB via Git LFS,
  so engordavam o clone) e passam a ser publicados nas **GitHub Releases** pelo CI.
- Nomes de artefato **sem versao** (`MullaCord-Web-Setup.exe`, `MullaCord-portable.exe`,
  `MullaCord-<arch>.dmg`, `MullaCord-PublicCert.cer`) — assim
  `github.com/.../releases/latest/download/<arquivo>` e sempre a ultima versao.
- `site/index.html` usa esses links diretos e detecta o SO do visitante no botao
  do topo. `releases/README.md` explica onde os arquivos foram parar.

### Correcao
- Documentado o *"This app can't run on your PC"* quando o `.exe` esta numa pasta
  do OneDrive (vira placeholder; o Windows nao executa placeholder) — mover pra
  fora resolve.

## 1.4.0

Instalador com a cara da marca + blindagem do pacote.

### Instalador
- **Assistido e ilustrado**: splash com fade na abertura (onda de sinal +
  logo), painel lateral e cabecalho da marca, paginas de licenca / pasta /
  progresso / conclusao, atalho "Abrir o Mulla Cord agora".
- **Sem UAC**: instala em `%LOCALAPPDATA%` (sem pedir admin), da pra trocar a pasta.
- `desktop/scripts/make-installer-art.js` gera a arte (BMP) a partir de HTML.

### Assinatura (Authenticode)
- Todos os `.exe` (app, servidor embutido, instalador, portatil) sao assinados
  com um certificado do projeto, com timestamp RFC3161.
- `npm run cert` gera `build/MullaCord-CodeSign.pfx` (fora do git) +
  `build/MullaCord-PublicCert.cer` (publico).
- **Nao remove o aviso do SmartScreen** (so um cert OV/EV pago com reputacao faz
  isso). O que da: publisher verificavel "Mulla Cord", deteccao de adulteracao,
  e quem quiser confiar importa o `.cer`. Passo a passo em `docs/INSTALL.md`.

### Blindagem do codigo
- **Electron Fuses**: sem `RunAsNode`, sem `NODE_OPTIONS`, sem `--inspect`, so
  carrega o app do asar, valida a integridade do asar embutido, cookies
  criptografados. (Efeito colateral bom: o `ELECTRON_RUN_AS_NODE` do terminal
  nao quebra mais o app empacotado.)
- **Ofuscacao** do JS do renderer no pacote (`src/` continua legivel no dev;
  `scripts/obfuscate.js` gera `src.dist/`). Nomes sem sentido, strings
  codificadas, control-flow leve. Nao e criptografia - a chave sempre viaja com
  o app - mas inspecao casual (F12) nao ve a logica limpa.

## 1.3.0

Novo modelo de conexão: **enxame auto-alimentado, sem nuvem e sem passo de "hospedar"**.

### Modelo de conexão v2
- **Nó local sempre no ar**: o app sobe o servidor em segundo plano ao abrir. Some
  o botão "Hospedar meu servidor".
- **Comunidade**: no primeiro uso você **cria uma comunidade**, **entra numa que
  apareceu na rede local** (um clique) ou cola um convite `mula://join/…`. Cada
  comunidade tem seu próprio banco (`%APPDATA%/Mulla Cord/communities/<id>/`).
- **Coordenador eleito** por prioridade → tempo no ar → id, para quem o cliente
  conecta enquanto o nó local ainda não sincronizou.
- Descoberta LAN agora carrega `community_id` / prioridade / `started_at` / endereço público.

### Enxame (replicação estilo torrent)
- Todo nó guarda a **réplica completa** (contas, amigos, canais, cargos, mensagens,
  anexos). O cliente fala sempre com o nó local (leitura instantânea).
- **oplog por triggers** + **anti-entropia** (`/api/replica/sync`, ~8s) + **push
  rápido** (0,5s). Conflito por **last-writer-wins** por linha. Compactação do log.
- **IDs por faixa de nó** (não colidem entre nós offline); **token da comunidade**
  (um login vale em qualquer nó); realtime dispara também nas escritas que chegam
  replicadas (`_dispatch_realtime`).
- `server/scripts/smoke_swarm.py`: 2 nós convergem em conta / amizade / DM / mensagem.

### App
- **Bandeja + iniciar com o Windows**: mantenha o app fechado mas o nó no ar como
  "semente" do enxame (Perfil → Comunidade → Este dispositivo).
- **UPnP best-effort**: tenta abrir a porta no roteador (SSDP + SOAP, sem dependência);
  se conseguir, grava o endereço público e ele vai no convite.
- Ao entrar por um peer, o app migra sozinho pro nó local quando ele termina de sincronizar.
- Painel de comunidade (convite, endereço público, "este PC é o coordenador", sair).

### Também
- Redesenho da interface em torno da **linha de sinal** (a waveform reativa que
  pulsa a cada mensagem/atividade), tipografia "readout" para telemetria, presença
  como barra de sinal (transmitindo/silêncio) no lugar da bolinha verde.

> Bancos anteriores à 1.3 ganham o log de replicação por *backfill* automático no
> primeiro boot.

## 0.2.0

Primeira versão com a marca **Mulla Cord** e binários prontos para usar.

### Novidades
- **Marca Mulla Cord**: paleta preto + amarelo, fonte Satoshi, tagline
  *"Your community, in tune"*, tela de loading animada, fundo em gradiente com
  parallax, grafismos de ondas de áudio.
- **Personalização** (perfil → Aparência): tema claro/escuro, cor de destaque
  (presets + cor custom), estilo de fundo (gradiente/aurora/sólido), parallax,
  animações e modo compacto — tudo por dispositivo.
- **Conta fácil**: registro só com nome + senha (e-mail opcional, senha mín. 6).
- **Multiusuário**: `GET /api/users` — diretório de contas do servidor para achar
  quem adicionar sem saber o `@` exato; busca na barra lateral + botão "Encontrar
  pessoas". Verificado ponta a ponta (`smoke_e2e.py`).
- **Anexos**: enviar imagens e vídeos (clipe, arrastar-soltar, colar Ctrl+V),
  grade de miniaturas + visualizador em tela cheia.
- **Status de jogo**: detecta o jogo aberto (lista de ~100 + custom) e mostra aos
  amigos o nome e o tempo de sessão.
- **Conexão**: descoberta na LAN por UDP, servidores conhecidos com sessão salva,
  link `mula://`, indicador de latência, reconexão automática, **modo host** (o app
  sobe o servidor bundlado e mostra os links).
- **Empacotamento**: instalador NSIS de 1 clique + executável portátil
  (`MullaCord-Setup-0.2.0.exe`, `MullaCord-portable-0.2.0.exe`), ambos com o
  servidor embutido. Atalhos "Mulla Cord" com ícone da marca.

### Também
- Janela sem moldura com barra de título própria; ícones SVG; toasts.
- Editar/apagar mensagem, menções `@usuário` / `@cargo` com autocomplete.
- Servidores (guilds) com canais de texto/voz, categorias, convites, lista de
  membros e permissões completas (bitfield, hierarquia, overwrites por canal).

## 0.1.0

Base: contas, amigos, DMs, grupos, chat em tempo real (WebSocket), voz e
compartilhamento de tela P2P (WebRTC mesh), servidor FastAPI + SQLite self-hosted.
