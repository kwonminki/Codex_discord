[CmdletBinding()]
param(
  [ValidateSet("All", "Bot", "Worker", "Relay")]
  [string]$Component = "All"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = if ($env:CODEX_DISCORD_REPO_ROOT) {
  $env:CODEX_DISCORD_REPO_ROOT
} else {
  Split-Path -Parent $scriptDirectory
}
$repoRoot = (Resolve-Path $repoRoot).Path

if (-not (Test-Path (Join-Path $repoRoot "package.json") -PathType Leaf)) {
  throw "AI Agent Discord Connector repo was not found at $repoRoot. Set CODEX_DISCORD_REPO_ROOT to the checkout path."
}

function Find-Application([string]$name) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    return $null
  }

  if ($command.Path) {
    return $command.Path
  }

  return $command.Source
}

$nodeCommand = if ($env:CODEX_DISCORD_NODE_COMMAND) {
  $env:CODEX_DISCORD_NODE_COMMAND
} else {
  Find-Application "node.exe"
}

if (-not $nodeCommand) {
  throw "node.exe was not found. Install a supported Node.js version or set CODEX_DISCORD_NODE_COMMAND."
}

if (-not $env:CODEX_DISCORD_CODEX_COMMAND) {
  $codexCommand = Find-Application "codex.exe"
  if ($codexCommand) {
    $env:CODEX_DISCORD_CODEX_COMMAND = $codexCommand
  }
}

if (-not $env:CODEX_DISCORD_CLAUDE_COMMAND) {
  $claudeCommand = Find-Application "claude.exe"
  if ($claudeCommand) {
    $env:CODEX_DISCORD_CLAUDE_COMMAND = $claudeCommand
  }
}

if (-not $env:CODEX_DISCORD_CODEX_RUNNER) {
  $env:CODEX_DISCORD_CODEX_RUNNER = "app-server"
}

if (-not $env:CONNECT_WORKSPACE_SHELL) {
  $pwshCommand = Find-Application "pwsh.exe"
  $env:CONNECT_WORKSPACE_SHELL = if ($pwshCommand) { $pwshCommand } else { "powershell.exe" }
}

$logRoot = if ($env:CODEX_DISCORD_LOG_ROOT) {
  $env:CODEX_DISCORD_LOG_ROOT
} else {
  Join-Path $env:LOCALAPPDATA "CodexDiscordConnector\Logs"
}
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot ("{0}.log" -f $Component.ToLowerInvariant())

Set-Location $repoRoot
Start-Transcript -Path $logPath -Append | Out-Null

try {
  switch ($Component) {
    "Bot" {
      & $nodeCommand --import tsx apps/discord-bot/src/index.ts
    }
    "Worker" {
      & $nodeCommand --import tsx apps/local-agent/src/directWorker.ts
    }
    "Relay" {
      & $nodeCommand --import tsx apps/relay-bot/src/index.ts
    }
    default {
      & $nodeCommand --import tsx apps/connect-cli/src/index.ts start --direct
    }
  }

  exit $LASTEXITCODE
} finally {
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}
