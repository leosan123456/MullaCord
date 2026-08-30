# Changelog

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
