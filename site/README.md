# site/ — página de download do Mulla Cord

Página estática (um arquivo, `index.html`, com a fonte Satoshi embutida) para as
pessoas baixarem o app. Os botões apontam para os `.exe` em
[`../releases/`](../releases/) via URL absoluta do GitHub.

## Ver localmente

Abra `site/index.html` no navegador — não precisa de servidor.

## Publicar no GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Todo push em `main` que toque em `site/` roda [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)
   e publica a pasta.
3. O endereço sai em **Settings → Pages** (algo como
   `https://leosan123456.github.io/MullaCord/`).

## Ao lançar uma nova versão

Troque o número em três lugares do `index.html`: os dois links de download
(`MullaCord-Setup-<versão>.exe` e `MullaCord-portable-<versão>.exe`), a linha
`v1.3.0` do hero e do rodapé, e os nomes de arquivo nos cartões.
