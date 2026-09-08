# site/ — página de download do Mulla Cord

Página estática (um arquivo, `index.html`, com a fonte Satoshi embutida) para as
pessoas baixarem o app. Os botões usam **links diretos e sem versão** para a
última Release do GitHub:
`https://github.com/leosan123456/MullaCord/releases/latest/download/<arquivo>`
(`MullaCord-Web-Setup.exe`, `MullaCord-portable.exe`, `MullaCord-arm64.dmg`,
`MullaCord-x64.dmg`, `MullaCord-PublicCert.cer`). Um `<script>` no fim do
`index.html` troca o botão do topo pelo instalador do SO do visitante.

## Ver localmente

Abra `site/index.html` no navegador — não precisa de servidor.

## Publicar no GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Todo push em `main` que toque em `site/` roda [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)
   e publica a pasta.
3. O endereço sai em **Settings → Pages** (algo como
   `https://leosan123456.github.io/MullaCord/`).

## Ao lançar uma nova versão

Nada a fazer aqui — os links são sem versão e apontam sempre pra
`releases/latest`. É só o CI publicar a Release nova (push de tag `v*`).
