#!/usr/bin/env bash
# Instalador do MotoControl para Linux (Debian/Ubuntu).
# Uso:  sudo ./instalar.sh            (interativo)
#       sudo ./instalar.sh --yes      (sem perguntas; senha do admin é gerada e exibida)
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como administrador:  sudo ./instalar.sh"
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "Este instalador automatiza Debian/Ubuntu. Em outras distribuições, instale Node.js 20+ e"
  echo "PostgreSQL manualmente e execute:  sudo node scripts/setup.js"
  exit 1
fi

node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]
}

if ! command -v pg_dump >/dev/null 2>&1 && ! ls /usr/lib/postgresql/*/bin/pg_dump >/dev/null 2>&1; then
  echo "==> Instalando PostgreSQL..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql
fi
# Garante que o PostgreSQL está rodando (systemd ou, em contêineres, o script de serviço).
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl enable --now postgresql >/dev/null 2>&1 || true
else
  service postgresql start >/dev/null 2>&1 || true
fi

if ! node_ok; then
  echo "==> Instalando Node.js 22 LTS (repositório oficial NodeSource)..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi

exec node scripts/setup.js "$@"
