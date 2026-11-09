@echo off
setlocal
set "ROOT=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node is not installed. Install Node 24 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo Node 24 or newer is required.
  pause
  exit /b 1
)

if not exist "%ROOT%node_modules" (
  call npm --prefix "%ROOT%." install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

node "%ROOT%scripts\start.ts" --open %*
