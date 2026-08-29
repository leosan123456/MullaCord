# Mulla Cord

*Your community, in tune.* — app de conversas estilo Discord, self-hosted. Cada
pessoa cria uma conta (só nome + senha) e hospeda o próprio servidor no PC. Amigos
entram pela descoberta na rede local ou por um link `mula://`.

- **Multiusuário no mesmo servidor**: cada pessoa cria a conta dela, encontra as
  outras contas no diretório do servidor, manda pedido de amizade e conversa em
  tempo real (presença, "digitando")
- **Chat privado (DM) e grupos** de amigos
- **Servidores (guilds)** estilo Discord: canais de texto/voz, categorias, convites,
  lista de membros e **sistema completo de cargos e permissões** (bitfield, hierarquia,
  overwrites por canal)
- **Voz e compartilhamento de tela** via WebRTC P2P (mesh) — o servidor só faz signaling
- **Controles de áudio**: seletor de microfone/saída, modo (sempre ativo / por voz /
  push-to-talk), volume por pessoa, mudo, ensurdecer, medidor de nível
- **Mensagens**: editar, apagar, menções `@usuario` / `@cargo` com autocomplete
- **Anexos**: enviar imagens e vídeos (botão de clipe, arrastar-soltar, colar),
  grade de miniaturas + visualizador em tela cheia
- **Status de jogo**: detecta o jogo aberto e mostra aos amigos o nome e há quanto
  tempo você está jogando (lista de ~100 jogos + adicionar manualmente)
- **Perfil**: nome de exibição e avatar
- **Interface**: marca Mulla Cord (preto + amarelo, fonte Satoshi), tela de loading
  animada, fundo em gradiente com parallax, tema claro/escuro, janela sem moldura,
  ícones SVG. **Personalização**: cor de destaque, estilo de fundo, densidade,
  ligar/desligar animações e parallax
- **Conexão**: descoberta automática na rede local, servidores salvos, link `mula://`,
  indicador de latência, reconexão automática
- **Modo host**: o app sobe o servidor local e mostra os links para compartilhar
- **Servidor local**: FastAPI + SQLite (um backend hospeda vários servidores)
- **App desktop**: Electron + instalador Windows (app + servidor empacotados juntos)

> ⚠️ O schema mudou na fase 2. Apague `server/data/mulacord.sqlite3*` se vinha da fase 1.

## Baixar (Windows 64-bit)

Prontos para usar, em [`releases/`](releases/) — nenhum Python/Node necessário
(o servidor já vem embutido):

| Arquivo | O que faz |
|---|---|
| [`MullaCord-Setup-0.1.0.exe`](releases/MullaCord-Setup-0.1.0.exe) | **Instalador rápido** — 1 clique, instala e cria os atalhos "Mulla Cord" (área de trabalho + menu Iniciar) |
| [`MullaCord-portable-0.1.0.exe`](releases/MullaCord-portable-0.1.0.exe) | **Portátil** — dois cliques e abre, sem instalar nada |

> SmartScreen ("app não reconhecido"): os `.exe` não têm assinatura digital paga —
> **Mais informações → Executar assim mesmo**.

Passo a passo para novos usuários: [docs/INSTALL.md](docs/INSTALL.md).

## Estrutura

```
mulacord/
├── server/     backend Python (FastAPI + WebSocket + SQLite + descoberta UDP)
│   └── mulacord-server.spec   empacotamento PyInstaller
├── desktop/    app Electron (renderer HTML/JS, barra de título própria, modo host)
│   └── build/  ícone e recursos do instalador
└── docs/       arquitetura e protocolo
```

## Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Python | 3.11+ | detectado: 3.14.7 (use o launcher `py`) |
| Node.js + npm | 20+ | detectado: v24.20.0 |
| git | qualquer | **não instalado** — https://git-scm.com |

## Rodando o servidor

```powershell
cd server
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py     # sobe em http://0.0.0.0:8787
```

Teste rápido do backend (com o servidor no ar, noutro terminal):

```powershell
.\.venv\Scripts\python.exe scripts\smoke_test.py       # contas, amigos, DM, chat realtime
.\.venv\Scripts\python.exe scripts\smoke_guilds.py     # servidores, permissões, canal de voz
.\.venv\Scripts\python.exe scripts\smoke_messages.py   # perfil/avatar, editar/apagar mensagem
.\.venv\Scripts\python.exe scripts\smoke_discovery.py  # descoberta LAN por UDP + /api/info
.\.venv\Scripts\python.exe scripts\smoke_attachments.py # upload de imagem, mensagem com anexo, download
.\.venv\Scripts\python.exe scripts\smoke_activity.py    # status de jogo propagado a amigos
.\.venv\Scripts\python.exe scripts\smoke_e2e.py         # 2 usuários: busca, amizade, DM dos 2 lados
```

Amigos na mesma rede aparecem automaticamente no login. De fora da LAN, o host
libera a porta 8787 no roteador e passa o link `mula://<ip-público>:8787`.

## Rodando o app desktop

```powershell
cd desktop
npm install
npm start
```

No login: escolha um servidor da rede, cole um endereço / link `mula://`, ou clique
em **Hospedar meu servidor** para o app subir o servidor local.

> `npm start` passa por `scripts/start.js`, que remove `ELECTRON_RUN_AS_NODE`
> antes de subir o Electron (o terminal do VS Code define essa variável e ela
> faz o Electron rodar como Node puro e quebrar).

## Gerando o instalador

```powershell
cd server
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt   # PyInstaller

cd ..\desktop
npm run dist      # empacota o servidor + gera instalador + portátil
```

Saída em `desktop/dist-installer/`:

- `MullaCord-Setup-<versão>.exe` — instalador NSIS de 1 clique (cria os atalhos "Mulla Cord")
- `MullaCord-portable-<versão>.exe` — executável portátil, sem instalação

Os dois já incluem o app **e** o servidor. Não são assinados (sem certificado pago).
Depois de gerar, copie os `.exe` para `releases/` para versionar (usam Git LFS).

## Documentação

- [docs/INSTALL.md](docs/INSTALL.md) — manual de instalação e primeiros passos (novos usuários)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — visão geral, esquema de dados, protocolo do gateway
