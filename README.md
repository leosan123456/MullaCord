# Mulla Cord

*Your community, in tune.* — app de conversas estilo Discord, **sem nuvem e sem
passo de "hospedar"**. Você abre o app, ele acha quem está na mesma rede e vocês
já conversam. Cada app aberto é um **nó com a réplica inteira** da comunidade; os
nós se sincronizam entre si (estilo torrent) e o histórico se cura sozinho.

- **Comunidade em vez de "servidor"**: no primeiro uso você **cria uma comunidade**
  ou **entra numa que apareceu na rede** (ou cola um convite `mula://join/…` de um
  amigo de outra rede). Não existe mais botão "Hospedar".
- **Enxame auto-alimentado**: todo nó guarda contas, amigos, canais e mensagens
  inteiros. Anti-entropia + push rápido replicam as mudanças; se um PC desliga, os
  outros seguem com tudo. Deixe o app na bandeja pra ser uma "semente" sempre no ar.
- **Multiusuário**: cada pessoa cria a conta dela, encontra as outras no diretório
  da comunidade, manda pedido de amizade e conversa em tempo real (presença, "digitando")
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
- **Conexão**: nó local sobe sozinho no launch, descoberta automática na LAN,
  coordenador eleito por prioridade → tempo no ar → id, `mula://join/…` para a
  internet, tentativa de abrir a porta no roteador por **UPnP**, reconexão automática
- **Nó local**: FastAPI + SQLite + oplog por triggers + gossip. Cada nó é uma
  réplica completa; um backend ainda pode hospedar vários canais/servidores (guilds)
- **App desktop**: Electron + bandeja + iniciar com o Windows + instalador
  (app + servidor empacotados juntos)

> ⚠️ Bancos anteriores à 1.3 não têm o log de replicação; ao subir a 1.3 o nó faz
> o *backfill* automático. Se algo ficar estranho, apague `server/data/mulacord.sqlite3*`
> (ou `%APPDATA%/Mulla Cord/communities/<id>/`) e recomece.

## Baixar (Windows 64-bit)

Prontos para usar, em [`releases/`](releases/) — nenhum Python/Node necessário
(o servidor já vem embutido):

| Arquivo | O que faz |
|---|---|
| [`MullaCord-Setup-1.3.0.exe`](releases/MullaCord-Setup-1.3.0.exe) | **Instalador rápido** — 1 clique, instala e cria os atalhos "Mulla Cord" (área de trabalho + menu Iniciar) |
| [`MullaCord-portable-1.3.0.exe`](releases/MullaCord-portable-1.3.0.exe) | **Portátil** — dois cliques e abre, sem instalar nada |

> SmartScreen ("app não reconhecido"): os `.exe` não têm assinatura digital paga —
> **Mais informações → Executar assim mesmo**.

Passo a passo para novos usuários: [docs/INSTALL.md](docs/INSTALL.md).

Página de download (GitHub Pages): [`site/`](site/) — `index.html` estático com os
links dos instaladores; publique via **Settings → Pages → Source: GitHub Actions**
([workflow](.github/workflows/pages.yml)).

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
| Python | 3.11+ | 3.11–3.14; use o launcher `py`. SQLite ≥ 3.35 (RETURNING) — vem com o Python |
| Node.js + npm | 20+ | detectado: v24.20.0 |
| git | qualquer | https://git-scm.com |

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
.\.venv\Scripts\python.exe scripts\smoke_swarm.py       # 2 nós replicando: conta/amizade/DM/mensagem convergem (sobe 2 nós antes)
```

Para testar o enxame à mão: suba 2 nós apontando um pro outro e rode `smoke_swarm`.

```powershell
$env:MULACORD_PORT=8801; $env:MULACORD_DATA_DIR="$PWD\dataA"; $env:MULACORD_COMMUNITY_ID="teste"
$env:MULACORD_BOOTSTRAP_PEERS="http://127.0.0.1:8802"; .\.venv\Scripts\python.exe run.py   # noutro terminal, 8802 ↔ 8801
```

## Rodando o app desktop

```powershell
cd desktop
npm install
npm start
```

No primeiro uso: **crie uma comunidade**, **entre numa que apareceu na rede**, ou
cole um convite `mula://join/…`. O nó local sobe sozinho — não há passo de hospedar.
Depois disso o app entra direto (sessão salva por comunidade).

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

**Fluxo de atualização** (sempre que fechar um conjunto de mudanças): bump da versão
em `desktop/package.json` **e** `server/mulacord_server/__init__.py` → entrada no
`CHANGELOG.md` → `npm run dist` → copiar os `.exe` para `releases/` → commit + tag
`vX.Y.Z`.

## Documentação

- [docs/INSTALL.md](docs/INSTALL.md) — manual de instalação e primeiros passos (novos usuários)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — visão geral, esquema de dados, protocolo do gateway
- [CHANGELOG.md](CHANGELOG.md) — o que mudou em cada versão
