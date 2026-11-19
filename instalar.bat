@echo off
rem Instalador do MotoControl para Windows 10/11.
rem Clique com o botao direito e escolha "Executar como administrador".
rem
rem Usa os instaladores da pasta "instaladores" (pacote gerado por "npm run pacote", sem internet).
rem Se nao estiverem la, baixa pelo winget (precisa de internet).
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

rem ---------------------------------------------------------------- PostgreSQL
set "PG_FOUND="
where pg_dump >nul 2>&1 && set "PG_FOUND=1"
if not defined PG_FOUND if exist "%ProgramFiles%\PostgreSQL\" (
  for /d %%d in ("%ProgramFiles%\PostgreSQL\*") do if exist "%%d\bin\pg_dump.exe" set "PG_FOUND=1"
)
if not defined PG_FOUND (
  rem Senha do superusuario "postgres" gerada aleatoriamente e repassada ao instalador do MotoControl.
  for /f "usebackq" %%p in (`node -e "console.log(require('crypto').randomBytes(12).toString('hex'))"`) do set "PG_SUPERUSER_PASSWORD=%%p"
  set "PG_ARGS=--mode unattended --unattendedmodeui none --superpassword !PG_SUPERUSER_PASSWORD! --serverport 5432 --disable-components stackbuilder"
  set "PG_EXE="
  for %%f in ("instaladores\postgresql-*-windows-x64.exe") do set "PG_EXE=%%~ff"
  if defined PG_EXE (
    echo ==^> Instalando PostgreSQL a partir de !PG_EXE! ^(pode levar alguns minutos^)...
    start "" /wait "!PG_EXE!" !PG_ARGS!
    if errorlevel 1 goto :fim_erro
  ) else (
    call :need_winget || goto :fim_erro
    echo ==^> Baixando e instalando PostgreSQL 17 ^(pode levar alguns minutos^)...
    winget install --id PostgreSQL.PostgreSQL.17 -e --silent --accept-package-agreements --accept-source-agreements --override "!PG_ARGS!"
    if errorlevel 1 goto :fim_erro
  )
  > "%~dp0postgres-superusuario.txt" (
    echo Senha do usuario "postgres" do PostgreSQL, gerada na instalacao do MotoControl:
    echo !PG_SUPERUSER_PASSWORD!
    echo Guarde em local seguro e apague este arquivo.
  )
  echo  Senha do superusuario do PostgreSQL salva em postgres-superusuario.txt
)

rem ---------------------------------------------------------------- MotoControl
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
