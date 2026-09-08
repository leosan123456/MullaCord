# site/ — página de download do Mulla Cord

Página estática (um arquivo, `index.html`, com a fonte Satoshi embutida) para as
pessoas baixarem o app. Os botões usam **links diretos e sem versão** para a
última Release do GitHub:
`https://github.com/leosan123456/MullaCord/releases/latest/download/<arquivo>`
(`MullaCord-Web-Setup.exe`, `MullaCord-portable.exe`, `MullaCord-arm64.dmg`,
`MullaCord-x64.dmg`, `MullaCord-PublicCert.cer`). Um `<script>` no fim do
`index.html` troca o botão do topo pelo instalador do SO do visitante.

## SEO

- `<head>`: `<title>` e `description` com palavra-chave, `keywords`, `canonical`,
  `robots`, Open Graph + Twitter Card e **JSON-LD** (`SoftwareApplication` +
  `Organization` + `WebSite`) — pode gerar rich result de "app grátis".
- `og-image.png` (1200×630) — imagem de compartilhamento.
- `robots.txt` + `sitemap.xml` — o sitemap precisa ser enviado no
  [Google Search Console](https://search.google.com/search-console) (a URL é de
  projeto, `/MullaCord/`, então o `robots.txt` da raiz do `github.io` não é este).
- `.nojekyll` — o Pages serve os arquivos como estão, sem processar Jekyll.
- Ao mudar o domínio/URL, atualize `canonical`, `og:url`, `og:image`,
  `sitemap.xml` e o JSON-LD.

**Depois de publicar:** cadastre o site no Google Search Console, envie o
`sitemap.xml`, e valide os dados estruturados no
[Rich Results Test](https://search.google.com/test/rich-results).

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
