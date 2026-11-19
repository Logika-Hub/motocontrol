@echo off
rem Instalador do MotoControl para Windows 10/11.
rem Clique com o botao direito e escolha "Executar como administrador".
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

rem ---------------------------------------------------------------- Node.js
where node >nul 2>&1
if errorlevel 1 (
  call :need_winget || goto :fim_erro
  echo ==^> Instalando Node.js LTS...
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :fim_erro
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
for /f "usebackq" %%v in (`node -p "process.versions.node.split('.')[0]"`) do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 20 (
  echo  Node.js instalado e antigo ^(versao !NODE_MAJOR!^). Atualize para a versao LTS em https://nodejs.org/
  goto :fim_erro
)

rem ---------------------------------------------------------------- PostgreSQL
set "PG_FOUND="
where pg_dump >nul 2>&1 && set "PG_FOUND=1"
if not defined PG_FOUND if exist "%ProgramFiles%\PostgreSQL\" (
  for /d %%d in ("%ProgramFiles%\PostgreSQL\*") do if exist "%%d\bin\pg_dump.exe" set "PG_FOUND=1"
)
if not defined PG_FOUND (
  call :need_winget || goto :fim_erro
  echo ==^> Instalando PostgreSQL 16 ^(pode levar alguns minutos^)...
  rem Senha do superusuario "postgres" gerada aleatoriamente e repassada ao instalador do MotoControl.
  for /f "usebackq" %%p in (`node -e "console.log(require('crypto').randomBytes(12).toString('hex'))"`) do set "PG_SUPERUSER_PASSWORD=%%p"
  winget install --id PostgreSQL.PostgreSQL.16 -e --silent --accept-package-agreements --accept-source-agreements --override "--mode unattended --unattendedmodeui none --superpassword !PG_SUPERUSER_PASSWORD! --servicename postgresql-x64-16 --serverport 5432 --disable-components stackbuilder"
  if errorlevel 1 goto :fim_erro
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
  echo  O "winget" ^(Instalador de Aplicativos da Microsoft Store^) nao esta disponivel.
  echo  Instale manualmente o Node.js LTS ^(https://nodejs.org/^) e o PostgreSQL
  echo  ^(https://www.postgresql.org/download/windows/^) e execute este arquivo novamente.
  exit /b 1
)
exit /b 0

:fim_erro
echo.
echo  A instalacao nao foi concluida. Leia a mensagem acima.
pause
exit /b 1
