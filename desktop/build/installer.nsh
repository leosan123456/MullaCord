; Ícone próprio para os atalhos. O executável fica com o ícone padrão do
; Electron (assinar/editar o .exe exige o Modo de Desenvolvedor do Windows),
; mas o atalho da área de trabalho e do menu Iniciar usam o icon.ico.

!macro customInstall
  SetOutPath "$INSTDIR"
  File "/oname=icon.ico" "${BUILD_RESOURCES_DIR}\icon.ico"
  CreateShortCut "$DESKTOP\Mulla Cord.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Mulla Cord.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\icon.ico" 0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\icon.ico"
  Delete "$DESKTOP\Mulla Cord.lnk"
  Delete "$SMPROGRAMS\Mulla Cord.lnk"
!macroend
