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
| Sistema | Windows 10/11 (64-bit) |
| Disco | ~300 MB |
| Para conversar na LAN | só o app |
| Para amigos de outra rede | UPnP no roteador **ou** redirecionar a porta 8787 |

Baixe da pasta [`releases/`](../releases/) do repositório:

| Opção | Arquivo | Como usar |
|---|---|---|
| **Instalar** | `MullaCord-Setup-1.3.0.exe` | Dois cliques → instala em segundos e cria o atalho **Mulla Cord** na área de trabalho e no menu Iniciar. |
| **Portátil** | `MullaCord-portable-1.3.0.exe` | Dois cliques e o app abre. Nada é instalado; pode deixar num pen drive. |

> **SmartScreen** ("aplicativo não reconhecido"): os `.exe` não têm assinatura
> digital paga. Clique em **Mais informações → Executar assim mesmo**.

O app já traz o servidor embutido — não precisa instalar Python nem nada. Ao abrir,
ele sobe um **nó** em segundo plano sozinho.

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
> **Permitir acesso**.

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

# gerar o instalador
cd ..\server
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
cd ..\desktop
npm run dist       # -> desktop/dist-installer/MullaCord-Setup-<versão>.exe
                   #    e MullaCord-portable-<versão>.exe
```

## 8. Problemas comuns

| Problema | Solução |
|---|---|
| Windows bloqueou o instalador | SmartScreen — **Mais informações → Executar assim mesmo** |
| Não aparece nenhuma comunidade na rede | Mesma rede? Firewall liberado? Algum amigo com o app aberto? Peça um convite e cole |
| Amigo de outra cidade não conecta | UPnP falhou → port forwarding da 8787 + endereço público no painel de Comunidade, ou VPN |
| Sem áudio na chamada | Permissão de microfone no Windows; conferir dispositivo em Configurações de voz |
| Fechei o app e os amigos caíram | Ligue "Manter no ar em segundo plano" (Perfil → Comunidade), ou peça pra outra pessoa deixar o app aberto — a comunidade fica no ar por qualquer nó |
| Esqueci a senha | Sem e-mail não há recuperação; apagar o data dir da comunidade zera as contas dela |

---

Versão detalhada e ilustrada: veja o manual publicado do projeto.
