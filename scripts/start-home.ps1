param(
  [string]$EnvFile = ".env",
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $projectRoot

if (Test-Path -LiteralPath $EnvFile) {
  Get-Content -LiteralPath $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $parts = $line.Split("=", 2)
    if ($parts.Count -ne 2) { return }
    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if (-not $env:PORT) {
  $env:PORT = "8787"
}

if (-not $NodePath) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $NodePath = $nodeCommand.Source
  } else {
    $bundled = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    if (Test-Path -LiteralPath $bundled) {
      $NodePath = $bundled
    }
  }
}

if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) {
  throw "Node.js was not found. Install Node 20+ or pass -NodePath."
}

Write-Host "Starting TickTick ChatGPT MCP on port $env:PORT"
Write-Host "MCP URL will be: $($env:PUBLIC_BASE_URL)/mcp"
& $NodePath "src/server.mjs"
