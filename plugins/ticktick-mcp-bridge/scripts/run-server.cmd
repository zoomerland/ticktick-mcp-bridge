@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "SERVER=%SCRIPT_DIR%server.mjs"

if defined CODEX_NODE_PATH if exist "%CODEX_NODE_PATH%" (
  set "TICKTICK_NODE=%CODEX_NODE_PATH%"
  goto run
)

if defined NODE_EXE if exist "%NODE_EXE%" (
  set "TICKTICK_NODE=%NODE_EXE%"
  goto run
)

if defined USERPROFILE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  set "TICKTICK_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  goto run
)

for /f "delims=" %%N in ('where node.exe 2^>nul') do (
  "%%N" --version >nul 2>&1
  if not errorlevel 1 (
    set "TICKTICK_NODE=%%N"
    goto run
  )
)

echo TickTick MCP Bridge could not find Node.js. Install Node.js or set CODEX_NODE_PATH to node.exe.>&2
exit /b 1

:run
"%TICKTICK_NODE%" "%SERVER%"
exit /b %ERRORLEVEL%
