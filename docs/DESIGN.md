# Mulla Cord — sistema visual

> *Your community, in tune.*

Direção construída com a skill `frontend-design`: paleta, tipografia e layout
como escolhas feitas **para este produto** — um app de conversas self-hosted onde
o servidor roda no PC de um amigo. Pequeno, próprio, fora da grade.

## O que a marca trava (não mexer)

- Paleta exata: `#09090B` `#FACC15` `#EAB306` `#FDE047` `#FFFFFF` `#A1A1AA`
- Fonte **Satoshi** em toda a tipografia (300/400/500/700)
- Geometria do logo (cabeça no balão de fala) — só recolorir
- Tagline "Your community, in tune"; elementos Chat / Voice / Community / Live
- Grafismo de ondas de áudio ("in tune")

Preto + amarelo é o default nº 2 de UI gerada por IA — mas aqui **o brief fixa a
paleta**. A distinção vem dos eixos livres (layout, tipografia, movimento,
assinatura), não da cor.

## Tokens

### Cor (`styles.css` — `:root`)
| token | valor | papel |
|---|---|---|
| `--bg-app` | `#09090B` | o "void", base do app e da rail |
| `--bg-sidebar` | `#0C0C0E` | carbon |
| `--bg-content` | `#101013` | slate — o campo onde a conversa acontece |
| `--bg-elevated` | `#1A1A1F` | riser — cards, menus, avatares pequenos |
| `--bg-hover` | `rgba(250,204,21,.055)` | hover puxado pro **sinal**, não pro branco |
| `--signal` (`--accent`) | `#FACC15` | vivo / primário |
| `--signal-peak` | `#FDE047` | hover / pico |
| `--signal-sustain` | `#EAB306` | pressionado / segurado |
| `--green` | `#4ade80` | "go" — servidor no ar, meter, sucesso |
| `--danger` | `#E5484D` | só ações destrutivas |

Tema claro: mesmos papéis, off-white quente + ouro `#CA9A04`.

### Tipografia — Satoshi em três vozes
- **Display** — 700, tracking −0.03em: wordmark, títulos de tela
- **Body** — 400/500: pessoas falando
- **Readout** — `.readout`: 500, tracking +0.10em, versalete, tabular-nums.
  É a "voz de equipamento": latência, contagem, endereços, timers, rótulos de
  seção e de categoria. O readout diz *isto é a máquina te reportando*; o body
  diz *isto é gente*. Essa divisão é o dispositivo estrutural.

## Assinatura — a linha de sinal (`wave.js`)

Um `<canvas>` com uma waveform cor-de-sinal que **reage ao estado real do app**:

- **repouso**: senoide lenta, amplitude baixa — "sala quieta"
- **mensagem chega / enviada**: uma onda nasce à esquerda e viaja decaindo
- **alguém entra na call**: a amplitude sobe e fica alta enquanto tem voz
- **digitando**: um tremor curto

Aparece em três lugares, mesmo motor:
1. **Splash** — começa como ruído e resolve numa senoide limpa ("sintonizando")
2. **Abaixo do header do canal** — faixa fina, a espinha da tela
3. **Estado vazio** — maior, com "A sala está em silêncio"

Não é enfeite: é a leitura de se a comunidade está *in tune* agora. Toda a
ousadia foi gasta aqui — o resto é quieto e disciplinado.

## Linguagem (copy)

Vocabulário de rádio/transmissão, coerente com "in tune":
- conectado → **no ar** · reconectando → **sintonizando…** · desconectado → **fora do ar**
- "Conectar" a um servidor → **Sintonizar**; "Na sua rede" → **Sinais na rede**
- presença online = **transmitindo** (não "bolinha verde")

## Presença como sinal

Sem bolinha verde estilo Discord. A presença é uma **barra vertical de sinal**:
cheia e acesa = transmitindo; toco e apagada = em silêncio. (`.dot` em `styles.css`.)

## Quality floor

Responsivo, foco de teclado visível, `prefers-reduced-motion` respeitado (a linha
de sinal fica estática). Movimento concentrado: a linha é o orçamento de animação;
os blobs de gradiente do login foram reduzidos a dois, bem apagados.
