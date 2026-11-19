@echo off
rem Inicia o MotoControl (se ainda nao estiver rodando) e abre o sistema no navegador.
chcp 65001 >nul
cd /d "%~dp0"
title MotoControl
set "NODE=node"
where node >nul 2>&1 || set "NODE=%ProgramFiles%\nodejs\node.exe"
"%NODE%" scripts\control.js start --open
if errorlevel 1 (
  echo.
  pause
)
