@echo off
rem Para o servidor do MotoControl. Os outros computadores perdem o acesso ate ele ser iniciado de novo.
chcp 65001 >nul
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  rem O servidor roda como servico do sistema: pede permissao de administrador.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "NODE=node"
where node >nul 2>&1 || set "NODE=%ProgramFiles%\nodejs\node.exe"
"%NODE%" scripts\control.js stop
echo.
pause
