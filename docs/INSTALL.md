# Instalar o Mulla Cord

*Your community, in tune.*

No Mulla Cord **não existe servidor central e nem passo de "hospedar"**. Você abre
o app, ele acha quem está na mesma rede e vocês já conversam. Cada app aberto é um
**nó** que guarda a comunidade inteira; os nós se sincronizam entre si e o
histórico se cura sozinho.

- **Começar** → seções 1 a 4.
- **Deixar sempre no ar (semente)** e **amigos de outra rede** → seção 5.
- **Rodar do código-fonte** → seção 7.

---

## 1. Instalar o app

| | |
|---|---|
| Windows | 10 (versão 1809, de out/2018, ou mais nova) e 11 — 64-bit |
| macOS | 11 Big Sur ou mais novo — Apple Silicon ou Intel |
| Disco | ~300 MB |
| Para conversar na LAN | só o app |
| Para amigos de outra rede | UPnP no roteador **ou** redirecionar a porta 8787 |

Baixe da página de **[Releases](https://github.com/leosan123456/MullaCord/releases)** do projeto:

| Opção | Arquivo | Como usar |
|---|---|---|
| **Instalar (Windows)** | `MullaCord-Web-Setup-<versão>.exe` (~1 MB) | Assistente com a cara da marca. Baixa o app (~85 MB) durante a instalação — **precisa de internet nesse momento**. Instala em `%LOCALAPPDATA%` **sem pedir admin** e cria os atalhos **Mulla Cord**. |
| **Portátil (Windows)** | `MullaCord-portable-<versão>.exe` (~78 MB) | Dois cliques e o app abre. Nada é instalado, funciona **offline**; pode deixar num pen drive. |
| **macOS** | `MullaCord-<versão>-<arch>.dmg` | Abra o `.dmg` e arraste **Mulla Cord** para *Aplicativos*. `arm64` = Apple Silicon (M1+), `x64` = Intel. |

> **Windows — SmartScreen** ("aplicativo não reconhecido"): os `.exe` são assinados
> com um certificado do próprio projeto (não é um certificado pago com reputação),
> então o Windows ainda avisa. Clique em **Mais informações → Executar assim mesmo**.
>
> Quer sumir com o aviso? Importe **`MullaCord-PublicCert.cer`** (na mesma Release)
> em *Certificados → Autoridades de Certificação Raiz Confiáveis* (Win+R →
> `certmgr.msc`). Aí a assinatura passa a ser reconhecida como **"Mulla Cord"** e o
> Windows confia. A assinatura também garante que o `.exe` não foi adulterado.
>
> **macOS — Gatekeeper**: o app ainda não tem assinatura da Apple (conta paga), então
> o macOS diz *"não foi possível verificar o desenvolvedor"*. Na 1ª vez: **clique com
> o botão direito no app → Abrir → Abrir**. Ou pelo Terminal:
> `xattr -dr com.apple.quarantine "/Applications/Mulla Cord.app"`.

O app já traz o servidor embutido — não precisa instalar Python nem nada. Ao abrir,
ele sobe um **nó** em segundo plano sozinho.

> **Atualizações**: da 1.5.2 em diante o app se atualiza sozinho. No Windows baixa
> a correção em segundo plano e aplica ao fechar (um aviso no topo oferece
> "Reiniciar agora"); no macOS avisa e abre o `.dmg` novo. Pra desligar, defina a
> variável de ambiente `MULACORD_NO_UPDATER=1`.

## 2. Entrar numa comunidade

No primeiro uso a tela oferece três caminhos:

- **Na sua rede** — se alguém já abriu o Mulla Cord na mesma rede, a comunidade
  dele aparece ("Os Brothers · 3 pessoas · nesta rede"). Um clique e você entra.
- **Criar comunidade** — dê um nome e pronto; os amigos na mesma rede vão te achar.
- **Entrar com um convite** — cole um `mula://join/…` que um amigo de outra rede te
  mandou (ele copia em Perfil → Comunidade → Convite).

Depois disso o app entra direto — a sessão fica salva por comunidade.

## 3. Criar sua conta

Aba **Criar conta**:

- **Como quer ser chamado** — 3 a 32 caracteres.
- **Senha** — mínimo 6 caracteres.
- **E-mail** — opcional (link *+ adicionar e-mail*); serve só para recuperar a
  conta nessa comunidade.

O primeiro a criar conta numa comunidade nova vira o dono. Sua conta e o histórico
ficam em **todos** os nós da comunidade — se um PC desliga, os outros seguem com tudo.

## 3.1 Adicionar amigos

Todo mundo da comunidade aparece no botão **👥** ao lado de "Amigos" (ou digitando
na caixa de busca). Clique no **+** para mandar o pedido; a outra pessoa aceita e
vocês já podem trocar DM. Não precisa saber o nome de usuário exato.

## 4. Conversar, voz e tela

- DMs e grupos no botão 🏠; servidores na barra à esquerda.
- **Imagens e vídeos**: botão de clipe no campo de mensagem, ou arraste o arquivo
  pra janela, ou cole (Ctrl+V). Clique numa imagem pra ver em tela cheia.
- **Status de jogo**: o app reconhece o jogo que você abriu e mostra aos amigos o
  nome e o tempo de sessão. Liga/desliga em perfil 👤 → *Status de jogo* (lá também
  dá pra cadastrar um jogo que não foi reconhecido).
- Canal de voz: clique no 🔊 (ou **Entrar na call** numa DM). O Windows pede
  permissão de microfone na 1ª vez.
- **Tela**: botão dentro da chamada → escolha monitor/janela.
- **Configurações de voz** (engrenagem no rodapé da barra lateral): dispositivos,
  modo (sempre ativo / por voz / apertar para falar), volume por pessoa, medidor.

Voz e tela são P2P (direto entre os apps); o nó só faz o encontro. Bom até ~5 pessoas.
A conexão se recupera sozinha (ICE restart) se a rede oscilar.

> **Entre redes diferentes**: o app usa **STUN** (Google, embutido) pra atravessar
> a maioria dos NATs. Rede corporativa / operadora móvel (NAT simétrico) precisam
> de um **TURN** (relay) próprio — suba um [coturn](https://github.com/coturn/coturn)
> e cole em *Perfil 👤 → Comunidade → Servidores STUN/TURN*, uma linha por servidor:
> `turn:seu-servidor:3478 usuario senha`. Todos os nós da comunidade passam a
> anunciar esse TURN.

## 5. Semente do enxame e amigos de outra rede

**Deixar sempre no ar** — Perfil 👤 → *Comunidade* → *Este dispositivo*:

- **Manter no ar em segundo plano** — fechar a janela manda o app pra bandeja; o
  nó continua no enxame e os amigos seguem alcançando a comunidade por este PC.
- **Iniciar com o Windows** — o nó sobe junto com o PC (sem abrir a janela).

Um PC com essas duas opções ligadas vira a "semente" estável da comunidade.

**Amigos de outra rede** — Perfil 👤 → *Comunidade*:

1. O app tenta abrir a porta 8787 no roteador sozinho (**UPnP**). Se der certo, o
   **Convite** já sai com seu endereço público.
2. Não funcionou? Redirecione **8787/TCP** para o IP local deste PC (port
   forwarding) e preencha **Endereço público** = `SEU_IP_PUBLICO:8787`. Alternativa:
   os dois na mesma VPN (Tailscale, ZeroTier).
3. Copie o **Convite** (`mula://join/…`) e mande. Quem recebe cola em *Entrar com
   um convite*.

> **Firewall**: na 1ª vez o Windows pergunta — marque **Redes privadas** e
> **Permitir acesso**. Se você bloqueou sem querer, o app mostra um banner
> **"Liberar no Firewall"** (aceite o aviso do Windows). Também dá pra rodar à mão:
> `powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\MullaCord\resources\allow-firewall.ps1"`
> (ou com `-Remove` pra tirar as regras).

Dados em `%APPDATA%\Mulla Cord\communities\<id>\`.

## 6. Deixar com a sua cara

Ícone de perfil 👤 no rodapé → **Aparência**: tema claro/escuro, cor de destaque
(presets ou custom), fundo (gradiente/aurora/sólido), parallax, animações, modo
compacto. Fica salvo neste computador.

## 7. Rodar do código-fonte

Pré-requisitos: **Python 3.11+**, **Node.js 20+**.

```powershell
# servidor
cd server
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py            # http://0.0.0.0:8787

# app (noutro terminal)
cd desktop
npm install
npm start

# gerar o instalador (Windows)
cd ..\server
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
cd ..\desktop
npm install        # inclui javascript-obfuscator e @electron/fuses
npm run dist       # cert -> servidor -> ofusca + arte -> electron-builder
                   # -> desktop/dist-installer/nsis-web/MullaCord-Web-Setup-<versão>.exe (stub ~1 MB)
                   #    desktop/dist-installer/nsis-web/mulacord-desktop-<versão>-x64.nsis.7z (pacote)
                   #    desktop/dist-installer/MullaCord-portable-<versão>.exe
```

macOS: `npm run dist:mac` num Mac (o instalador-web e o `.dmg` de Mac saem do CI
em `.github/workflows/build.yml` num push de tag `v*`).

## 8. Problemas comuns

| Problema | Solução |
|---|---|
| **"This app can't run on your PC"** ao abrir o instalador | O `.exe` está numa pasta sincronizada pelo **OneDrive** e virou um *placeholder* (o Windows não executa placeholder). Mova o `.exe` pra fora do OneDrive (ex.: `Downloads`, `C:\`) e rode de lá. |
| Windows bloqueou o instalador | SmartScreen — **Mais informações → Executar assim mesmo**. Pra sumir de vez: importe `MullaCord-PublicCert.cer` (na Release) nas Autoridades de Certificação Raiz Confiáveis |
| Instalador-web falhou ao baixar | Precisa de internet **durante** a instalação (ele puxa ~85 MB da Release do GitHub). Sem internet no PC de destino, use o **portátil**. |
| macOS: "não é possível abrir — desenvolvedor não verificado" | Botão direito no app → **Abrir** → **Abrir**. Ou: `xattr -dr com.apple.quarantine "/Applications/Mulla Cord.app"` |
| Não aparece nenhuma comunidade na rede | Mesma rede? Firewall liberado? Algum amigo com o app aberto? Peça um convite e cole |
| Entrei na comunidade mas **não acho a outra pessoa** | Os nós não estão sincronizando. Quase sempre é **Firewall**: no PC que criou a comunidade, clique **"Liberar no Firewall"** no banner (ou rode o `allow-firewall.ps1`). Cheque também: os dois na mesma rede e sem "isolamento de clientes"/rede de convidado no Wi-Fi. A barra lateral mostra "sincronizando pessoas… X/Y" enquanto empareia. |
| Amigo de outra cidade não conecta | UPnP falhou → port forwarding da 8787 + endereço público no painel de Comunidade, ou VPN |
| Sem áudio na chamada | Permissão de microfone no Windows; conferir dispositivo em Configurações de voz |
| Fechei o app e os amigos caíram | Ligue "Manter no ar em segundo plano" (Perfil → Comunidade), ou peça pra outra pessoa deixar o app aberto — a comunidade fica no ar por qualquer nó |
| Esqueci a senha | Sem e-mail não há recuperação; apagar o data dir da comunidade zera as contas dela |

---

Versão detalhada e ilustrada: veja o manual publicado do projeto.
