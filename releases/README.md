# Os instaladores mudaram de lugar

A partir da **1.5.0** os instaladores **não ficam mais aqui** no repositório — eles
são gerados pelo CI e publicados nas **Releases do GitHub**:

## → https://github.com/leosan123456/MullaCord/releases/latest

Links diretos (sempre a última versão):

| Arquivo | Link |
|---|---|
| Windows — instalador web (~1 MB) | <https://github.com/leosan123456/MullaCord/releases/latest/download/MullaCord-Web-Setup.exe> |
| Windows — portátil / offline (~78 MB) | <https://github.com/leosan123456/MullaCord/releases/latest/download/MullaCord-portable.exe> |
| macOS — Apple Silicon | <https://github.com/leosan123456/MullaCord/releases/latest/download/MullaCord-arm64.dmg> |
| macOS — Intel | <https://github.com/leosan123456/MullaCord/releases/latest/download/MullaCord-x64.dmg> |
| Certificado público (SmartScreen) | <https://github.com/leosan123456/MullaCord/releases/latest/download/MullaCord-PublicCert.cer> |

Por que mudou: o instalador web baixa o pacote da Release durante a instalação, e
manter `.exe` de ~90 MB no Git (via LFS) só engordava o clone. Ver
[`docs/INSTALL.md`](../docs/INSTALL.md).
