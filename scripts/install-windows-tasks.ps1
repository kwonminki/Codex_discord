[CmdletBinding()]
param(
  [string]$TaskPrefix = "CodexDiscordConnector",
  [switch]$IncludeRelay,
  [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = (Resolve-Path (Join-Path $scriptDirectory "start-windows-direct.ps1")).Path
$repoRoot = (Resolve-Path (Split-Path -Parent $scriptDirectory)).Path
$powerShellExecutable = (Get-Process -Id $PID).Path
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Register-ConnectorTask([string]$component) {
  $taskName = "$TaskPrefix-$component"
  $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`" -Component $component"
  $action = New-ScheduledTaskAction `
    -Execute $powerShellExecutable `
    -Argument $arguments `
    -WorkingDirectory $repoRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "AI Agent Discord Connector $component component" `
    -Force | Out-Null

  if ($StartNow) {
    Start-ScheduledTask -TaskName $taskName
  }

  Write-Host "Registered $taskName"
}

Register-ConnectorTask "Worker"
Register-ConnectorTask "Bot"
if ($IncludeRelay) {
  Register-ConnectorTask "Relay"
}

Write-Host "Logs: $env:LOCALAPPDATA\CodexDiscordConnector\Logs"
Write-Host "Inspect with: Get-ScheduledTask -TaskName '$TaskPrefix-*' | Get-ScheduledTaskInfo"
