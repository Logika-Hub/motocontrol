@echo off
rem Instalador do MotoControl para Windows 10/11.
rem Clique com o botao direito e escolha "Executar como administrador".
rem
rem Usa os instaladores da pasta "instaladores" (pacote gerado por "npm run pacote", sem internet).
rem Se nao estiverem la, baixa pelo winget (precisa de internet). Aqui so o Node.js e instalado;
rem o restante (inclusive o PostgreSQL) fica com o scripts\setup.js.
setlocal EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title Instalacao do MotoControl

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Este instalador precisa de permissao de administrador.
  echo  Clique com o botao direito em instalar.bat e escolha "Executar como administrador".
  echo.
  pause
  exit /b 1
)

rem Instalar a partir do pendrive nao funciona: o sistema roda a partir desta pasta.
for /f "usebackq" %%T in (`powershell -NoProfile -Command "(Get-CimInstance Win32_LogicalDisk -Filter 'DeviceID=''%~d0''').DriveType"`) do (
  if "%%T"=="2" (
    echo.
    echo  Copie a pasta do MotoControl para o disco do computador ^(ex.: C:\MotoControl^)
    echo  e execute o instalar.bat de la. O sistema nao pode rodar a partir do pendrive.
    echo.
    pause
    exit /b 1
  )
)

rem ---------------------------------------------------------------- Node.js
where node >nul 2>&1
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>&1
if errorlevel 1 (
  set "NODE_MSI="
  for %%f in ("instaladores\node-v*-x64.msi") do set "NODE_MSI=%%~ff"
  if defined NODE_MSI (
    echo ==^> Instalando Node.js a partir de !NODE_MSI!...
    start "" /wait msiexec /i "!NODE_MSI!" /qn /norestart
    if errorlevel 1 goto :fim_erro
  ) else (
    call :need_winget || goto :fim_erro
    echo ==^> Baixando e instalando Node.js LTS...
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 goto :fim_erro
  )
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
for /f "usebackq" %%v in (`node -p "process.versions.node.split('.')[0]"`) do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 20 (
  echo  O Node.js instalado e antigo ^(versao !NODE_MAJOR!^). Desinstale-o pelo Painel de Controle
  echo  e execute este instalador novamente.
  goto :fim_erro
)

rem ---------------------------------------------------------------- PostgreSQL e MotoControl
rem O PostgreSQL e instalado pelo scripts\setup.js (pasta "instaladores" ou winget), que pede
rem a senha do banco ao usuario.
node scripts\setup.js %*
if errorlevel 1 goto :fim_erro
echo.
pause
exit /b 0

:need_winget
where winget >nul 2>&1
if errorlevel 1 (
  echo  Os instaladores nao estao na pasta "instaladores" e o "winget" nao esta disponivel.
  echo  Use o pacote completo gerado por "npm run pacote" ou instale manualmente o Node.js LTS
  echo  ^(https://nodejs.org/^) e o PostgreSQL ^(https://www.postgresql.org/download/windows/^).
  exit /b 1
)
exit /b 0

:fim_erro
echo.
echo  A instalacao nao foi concluida. Leia a mensagem acima.
pause
exit /b 1
