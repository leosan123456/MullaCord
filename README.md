# Mulla Cord

*Your community, in tune.* — app de conversas estilo Discord, self-hosted. Cada
pessoa cria uma conta (só nome + senha) e hospeda o próprio servidor no PC. Amigos
entram pela descoberta na rede local ou por um link `mula://`.

- **Chat privado (DM) e grupos** de amigos
- **Servidores (guilds)** estilo Discord: canais de texto/voz, categorias, convites,
  lista de membros e **sistema completo de cargos e permissões** (bitfield, hierarquia,
  overwrites por canal)
- **Voz e compartilhamento de tela** via WebRTC P2P (mesh) — o servidor só faz signaling
- **Controles de áudio**: seletor de microfone/saída, modo (sempre ativo / por voz /
  push-to-talk), volume por pessoa, mudo, ensurdecer, medidor de nível
- **Mensagens**: editar, apagar, menções `@usuario` / `@cargo` com autocomplete
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
npm run dist      # empacota o servidor (PyInstaller) + gera o instalador NSIS
```

Saída: `desktop/dist-installer/Mulla Cord Setup <versão>.exe` — inclui o app e o
servidor. Ao instalar, cria os atalhos **"Mulla Cord"** na área de trabalho e no
menu Iniciar (com o ícone da marca). O instalador não é assinado (sem certificado).

## Documentação

- [docs/INSTALL.md](docs/INSTALL.md) — manual de instalação e primeiros passos (novos usuários)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — visão geral, esquema de dados, protocolo do gateway
