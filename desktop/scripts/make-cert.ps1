# Gera um certificado auto-assinado de assinatura de codigo para o Mulla Cord.
#
# Isso NAO remove o aviso do SmartScreen ("app nao reconhecido") - so um
# certificado OV/EV pago com reputacao faz isso. O que este certificado da:
#   - identidade verificavel do publisher ("Mulla Cord")
#   - deteccao de adulteracao (a assinatura quebra se o .exe for modificado)
#   - quem quiser confiar importa o build/MullaCord-PublicCert.cer
#
# Saida (em desktop/build/, fora do git menos o .cer):
#   MullaCord-CodeSign.pfx      chave privada + cert (usada pra assinar)
#   MullaCord-PublicCert.cer    so o cert publico (pode versionar/distribuir)
#   .cert-pass                  senha do .pfx (lida pelo scripts/sign.js)

$ErrorActionPreference = "Stop"
$buildDir = Join-Path $PSScriptRoot "..\build"
$pfxPath  = Join-Path $buildDir "MullaCord-CodeSign.pfx"
$cerPath  = Join-Path $buildDir "MullaCord-PublicCert.cer"
$passPath = Join-Path $buildDir ".cert-pass"

if ((Test-Path $pfxPath) -and -not ($args -contains "-force")) {
  Write-Host "Certificado ja existe em $pfxPath (use -force para recriar)."
  exit 0
}

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$pass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 28 | ForEach-Object { [char]$_ })
Set-Content -Path $passPath -Value $pass -NoNewline -Encoding ascii
$securePass = ConvertTo-SecureString -String $pass -Force -AsPlainText

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Mulla Cord, O=Mulla Cord, C=BR" `
  -FriendlyName "Mulla Cord Code Signing" `
  -KeyAlgorithm RSA -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyUsage DigitalSignature `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(5) `
  -CertStoreLocation "Cert:\CurrentUser\My"

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePass | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -Force

Write-Host "Certificado gerado:"
Write-Host ("  " + $pfxPath)
Write-Host ("  " + $cerPath + "  (publico)")
Write-Host ("  thumbprint " + $cert.Thumbprint)
