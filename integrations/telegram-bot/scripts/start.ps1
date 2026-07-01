param(
  [string]$NodePath = "node"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BotRoot = Resolve-Path (Join-Path $ScriptDir "..")

Push-Location $BotRoot
try {
  & $NodePath "src/index.mjs"
}
finally {
  Pop-Location
}
