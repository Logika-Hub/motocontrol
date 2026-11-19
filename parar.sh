#!/usr/bin/env bash
# Para o servidor do MotoControl (use sudo se ele roda como serviço do systemd).
cd "$(dirname "$0")" && exec node scripts/control.js stop
