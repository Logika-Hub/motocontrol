#!/usr/bin/env bash
# Inicia o MotoControl (se ainda não estiver rodando) e abre o navegador.
cd "$(dirname "$0")" && exec node scripts/control.js start --open
