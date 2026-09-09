; Personalizacao do instalador Mulla Cord.
;  - splash com fade na abertura (AdvSplash, plugin nativo do NSIS)
;  - atalhos com o icone da marca (o .exe fica com o icone padrao do Electron
;    porque assinar/editar recursos exige o Modo de Desenvolvedor do Windows)
;  - regras de firewall pra comunicacao na LAN

!include "LogicLib.nsh"

!macro customInit
  InitPluginsDir
  File "/oname=$PLUGINSDIR\mc-splash.bmp" "${BUILD_RESOURCES_DIR}\splash.bmp"
  ; advsplash::show  <mostrar ms>  <fade-in ms>  <fade-out ms>  <cor transparente>  <arquivo sem extensao>
  advsplash::show 900 450 500 -1 "$PLUGINSDIR\mc-splash"
  Pop $0
  Delete "$PLUGINSDIR\mc-splash.bmp"
!macroend

!macro customInstall
  SetOutPath "$INSTDIR"
  File "/oname=icon.ico" "${BUILD_RESOURCES_DIR}\icon.ico"
  CreateShortCut "$DESKTOP\Mulla Cord.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Mulla Cord.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\icon.ico" 0

  ; Firewall: a comunidade so sincroniza se a ENTRADA em 8787/TCP (HTTP/WS entre
  ; os nos) e 8788/UDP (descoberta na LAN) estiver liberada.
  ;  1. tenta silencioso (pega se o instalador ja estiver elevado);
  ;  2. se nao criou (instalador sem admin), roda o allow-firewall.ps1 elevado
  ;     -> um unico prompt do UAC. O app ainda oferece o mesmo botao depois.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mulla Cord (rede local)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mulla Cord (descoberta)"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mulla Cord (rede local)" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mulla Cord (rede local)" dir=in action=allow program="$INSTDIR\resources\server\mulacord-server.exe" enable=yes profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mulla Cord (descoberta)" dir=in action=allow protocol=UDP localport=8788 enable=yes profile=private,domain'

  ; deu certo (instalador elevado)? senao, num install interativo, roda o
  ; allow-firewall.ps1 que se auto-eleva -> um UAC claro. Em /S (scriptado)
  ; nao mexe; o app oferece o mesmo botao "Liberar no Firewall" depois.
  nsExec::ExecToStack 'netsh advfirewall firewall show rule name="Mulla Cord (descoberta)"'
  Pop $0
  Pop $1
  ${IfNot} ${Silent}
  ${AndIf} $0 != 0
    ExecShell "" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\allow-firewall.ps1" -Exe "$INSTDIR\${APP_EXECUTABLE_FILENAME},$INSTDIR\resources\server\mulacord-server.exe"'
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$INSTDIR\icon.ico"
  Delete "$DESKTOP\Mulla Cord.lnk"
  Delete "$SMPROGRAMS\Mulla Cord.lnk"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mulla Cord (rede local)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mulla Cord (descoberta)"'
!macroend
