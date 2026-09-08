; Personalizacao do instalador Mulla Cord.
;  - splash com fade na abertura (AdvSplash, plugin nativo do NSIS)
;  - atalhos com o icone da marca (o .exe fica com o icone padrao do Electron
;    porque assinar/editar recursos exige o Modo de Desenvolvedor do Windows)

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

  ; Firewall: libera a entrada na LAN (o no escuta em 8787/TCP + 8788/UDP) pros
  ; apps se sincronizarem. So pega se o instalador estiver elevado; sem admin
  ; falha em silencio e o app oferece o mesmo no botao "Liberar no Firewall".
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mulla Cord (rede local)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mulla Cord (descoberta)"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mulla Cord (rede local)" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mulla Cord (rede local)" dir=in action=allow program="$INSTDIR\resources\server\mulacord-server.exe" enable=yes profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mulla Cord (descoberta)" dir=in action=allow protocol=UDP localport=8788 enable=yes profile=private,domain'
!macroend

!macro customUnInstall
  Delete "$INSTDIR\icon.ico"
  Delete "$DESKTOP\Mulla Cord.lnk"
  Delete "$SMPROGRAMS\Mulla Cord.lnk"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mulla Cord (rede local)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mulla Cord (descoberta)"'
!macroend
