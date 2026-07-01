param(
  [string]$NodePath = "node"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceRoot = Resolve-Path (Join-Path $ScriptDir "..")

Push-Location $ServiceRoot
try {
  & $NodePath "src/server.mjs"
}
finally {
  Pop-Location
}
