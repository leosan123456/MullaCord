# Libera o Mulla Cord no Firewall do Windows para a rede local.
#
# O nó do Mulla Cord escuta em TCP 8787 (HTTP/WebSocket entre os apps) e responde
# descoberta em UDP 8788. Se o Firewall bloquear a ENTRADA nessas portas, os apps
# na mesma rede se enxergam na descoberta mas nao conseguem sincronizar contas e
# mensagens — cada um fica numa replica isolada.
#
# Este script cria regras de ENTRADA (perfis Particular + Domanio; nunca Publico).
# Precisa de admin: se rodar sem, ele se re-lanca elevado (1 prompt do UAC).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File allow-firewall.ps1
#   powershell -ExecutionPolicy Bypass -File allow-firewall.ps1 -Exe "C:\...\MullaCord.exe,C:\...\mulacord-server.exe"
#   powershell -ExecutionPolicy Bypass -File allow-firewall.ps1 -Remove

param(
  [string]$Exe = "",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$RuleTcp = "Mulla Cord (rede local)"
$RuleUdp = "Mulla Cord (descoberta)"
$TcpPort = 8787
$UdpPort = 8788

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  $a = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
  if ($Exe)    { $a += @("-Exe", "`"$Exe`"") }
  if ($Remove) { $a += "-Remove" }
  try {
    $p = Start-Process powershell -Verb RunAs -PassThru -Wait -ArgumentList $a
    exit $p.ExitCode
  } catch {
    Write-Warning "Elevacao cancelada — as regras nao foram alteradas."
    exit 1
  }
}

# limpa regras antigas (idempotente)
foreach ($n in @($RuleTcp, $RuleUdp, "Mulla Cord", "Mulla Cord (UDP)")) {
  cmd /c "netsh advfirewall firewall delete rule name=`"$n`"" | Out-Null
}

if ($Remove) {
  Write-Host "Regras do Mulla Cord removidas do Firewall."
  exit 0
}

# executaveis a liberar: os passados em -Exe + os caminhos padrao de instalacao
$exes = @()
if ($Exe) { $exes += ($Exe -split ',' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ }) }
$exes += @(
  "$env:LOCALAPPDATA\Programs\MullaCord\MullaCord.exe",
  "$env:LOCALAPPDATA\Programs\MullaCord\resources\server\mulacord-server.exe"
)
$exes = $exes | Where-Object { Test-Path $_ } | Select-Object -Unique

if ($exes.Count -gt 0) {
  # regra por-programa: so o Mulla Cord passa, em qualquer porta que ele use
  foreach ($e in $exes) {
    cmd /c "netsh advfirewall firewall add rule name=`"$RuleTcp`" dir=in action=allow program=`"$e`" enable=yes profile=private,domain" | Out-Null
  }
  Write-Host "Liberado por programa:"
  $exes | ForEach-Object { Write-Host "  $_" }
} else {
  # sem os .exe (build/portatil): cai pra regra por-porta
  cmd /c "netsh advfirewall firewall add rule name=`"$RuleTcp`" dir=in action=allow protocol=TCP localport=$TcpPort enable=yes profile=private,domain" | Out-Null
  Write-Host "Liberada a porta TCP $TcpPort."
}

cmd /c "netsh advfirewall firewall add rule name=`"$RuleUdp`" dir=in action=allow protocol=UDP localport=$UdpPort enable=yes profile=private,domain" | Out-Null
Write-Host "Liberada a descoberta UDP $UdpPort."
Write-Host ""
Write-Host "Pronto. Reabra o Mulla Cord nos dois PCs."
exit 0
