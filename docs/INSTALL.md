# Instalar o Mulla Cord

*Your community, in tune.*

No Mulla Cord **não existe servidor central**: quem quiser hospedar roda o próprio
servidor no PC; o app conecta ao servidor de um amigo — ou ao seu.

- **Só quero conversar** → seções 1 a 4.
- **Quero hospedar** → seção 5.
- **Rodar do código-fonte** → seção 7.

---

## 1. Instalar o app

| | |
|---|---|
| Sistema | Windows 10/11 (64-bit) |
| Disco | ~300 MB |
| Para conversar | só o app |
| Para hospedar | liberar a porta 8787 |

1. Baixe `Mulla Cord Setup 0.1.0.exe`.
2. Dois cliques para instalar; escolha a pasta e avance.
3. Um atalho **Mulla Cord** aparece na área de trabalho e no menu Iniciar.

> **SmartScreen** ("aplicativo não reconhecido"): o instalador não tem assinatura
> digital paga. Clique em **Mais informações → Executar assim mesmo**.

O app já traz o servidor embutido — não precisa instalar Python nem nada.

## 2. Escolher um servidor

Ao abrir, a tela de conexão oferece três caminhos:

- **Na sua rede** — se um amigo hospeda na mesma rede, o servidor dele aparece
  sozinho. Clique nele.
- **Por link** — cole `mula://192.168.0.10:8787` (ou `192.168.0.10:8787`) e clique
  em **Conectar**. Clicar num link `mula://` também abre o app.
- **Hospedar o meu** — veja a seção 5.

Servidores já usados ficam salvos; se a sessão for válida, o app reconecta sozinho.

## 3. Criar sua conta

Aba **Criar conta**:

- **Como quer ser chamado** — 3 a 32 caracteres.
- **Senha** — mínimo 6 caracteres.
- **E-mail** — opcional (link *+ adicionar e-mail*); serve só para recuperar a
  conta nesse servidor.

Cada servidor tem contas próprias. O primeiro a criar conta num servidor novo
vira o dono.

## 4. Conversar, voz e tela

- DMs e grupos no botão 🏠; servidores na barra à esquerda.
- Canal de voz: clique no 🔊 (ou **Entrar na call** numa DM). O Windows pede
  permissão de microfone na 1ª vez.
- **Tela**: botão dentro da chamada → escolha monitor/janela.
- **Configurações de voz** (engrenagem no rodapé da barra lateral): dispositivos,
  modo (sempre ativo / por voz / apertar para falar), volume por pessoa, medidor.

Voz e tela são P2P (direto entre os apps); o servidor só faz o encontro. Bom até ~5 pessoas.

## 5. Hospedar seu servidor

Tela de conexão → **Hospedar meu servidor neste PC**:

1. Dê um nome.
2. **Iniciar servidor** — o app sobe tudo.
3. Ao ficar **no ar**, os links para compartilhar aparecem:
   - `mula://127.0.0.1:8787` — só neste PC
   - `mula://192.168.x.x:8787` — amigos na mesma rede

> **Firewall**: na 1ª vez o Windows pergunta — marque **Redes privadas** e
> **Permitir acesso**.

**Amigos pela internet:** no seu roteador, redirecione a porta **8787/TCP** para o
IP local do seu PC (port forwarding) e passe o link com seu **IP público**
(`mula://SEU_IP_PUBLICO:8787`). Alternativa: os dois na mesma VPN (Tailscale, ZeroTier).

O modo host roda enquanto o app está aberto. Dados em `%APPDATA%\Mulacord\server`.
Para um servidor 24/7, rode do código-fonte (seção 7).

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
npm run dist       # -> desktop/dist-installer/Mulla Cord Setup <versão>.exe
```

## 8. Problemas comuns

| Problema | Solução |
|---|---|
| Windows bloqueou o instalador | SmartScreen — **Mais informações → Executar assim mesmo** |
| Amigo não me encontra na rede | Mesma rede? Firewall liberado? App do host aberto? Mande o link `mula://` direto |
| Amigo de outra cidade não conecta | Port forwarding da 8787 + IP público, ou VPN entre os dois |
| Sem áudio na chamada | Permissão de microfone no Windows; conferir dispositivo em Configurações de voz |
| Servidor caiu ao fechar o app | O modo host roda com o app aberto; para 24/7 rode do código-fonte |
| Esqueci a senha | Sem e-mail não há recuperação; o dono pode apagar `mulacord.sqlite3` (zera o servidor) |

---

Versão detalhada e ilustrada: veja o manual publicado do projeto.
