# Instalação e implantação

O passo a passo para quem instala na oficina está no manual: [Servidor, backup e atualização](../manual/06-servidor-e-backup.md). Aqui está o que acontece por baixo.

## Fluxo

```
  Seu computador (com internet)                Servidor da oficina (sem internet)
 ┌─────────────────────────────┐   pendrive   ┌──────────────────────────────────────────────┐
 │ npm run pacote               │ ───────────► │ instalar.bat (como administrador)            │
 │  → dist/MotoControl-x.y.z/   │              │  1. Node.js: instaladores/*.msi (ou winget)  │
 │     node_modules/            │              │  2. node scripts/setup.js:                   │
 │     instaladores/node*.msi   │              │     - PostgreSQL: instaladores/*.exe (ou     │
 │     instaladores/postgresql* │              │       winget), com senha definida na hora    │
 │     LEIA-ME.txt              │              │     - banco, .env, tabelas, admin            │
 │                              │              │     - tarefa agendada, firewall, atalhos     │
 └─────────────────────────────┘              └──────────────────────────────────────────────┘
```

## Gerar o pacote — `scripts/gerar-pacote.js`

- Baixa o **Node.js LTS mais recente** (`.msi` x64) de nodejs.org e confere o **SHA-256** com o `SHASUMS256.txt` oficial. Fixe a versão principal com `NODE_MAJOR=24 npm run pacote`.
- Baixa o **PostgreSQL** de `PG_DEFAULT_URL` (no topo do arquivo) ou `PG_INSTALLER_URL`. Se falhar, coloque o instalador *Windows x86-64* manualmente em `./instaladores/`.
- Os instaladores ficam em cache em `./instaladores/` (fora do Git).
- Copia os arquivos do projeto **exceto** `tests/`, `docs/contexto/`, `docs/tecnico/`, `README.md` e `CLAUDE.md` (a oficina recebe o manual e o `LEIA-ME.txt`), roda `npm ci --omit=dev`, converte `.bat` para CRLF e gera `LEIA-ME.txt` e o `.zip`.

## Instalador — `scripts/setup.js`

| Etapa | O que faz | Idempotência |
|---|---|---|
| 1. Pré-requisitos | Node ≥ 20; localiza `pg_dump` (PATH ou `Program Files\PostgreSQL\*\bin`). **Windows sem PostgreSQL:** pede a senha do `postgres` (oculta, com confirmação) e instala pelo `.exe` de `instaladores/` ou pelo `winget`, passando os argumentos sem shell | Pula se já instalado |
| 2. Dependências | `npm ci --omit=dev`, ou pula se já vierem no pacote | Pula se presentes |
| 3. Banco | Conecta como superusuário (Linux root: `runuser -u postgres psql`; senão usuário/senha) e cria role + banco `motocontrol` com senha aleatória | Mantém tudo se o `.env` já existe |
| 4. `.env` | `SESSION_SECRET` aleatório, `DATABASE_URL`, caminhos do `pg_dump`/`pg_restore`, permissão 600 | Não sobrescreve |
| 5. Tabelas e admin | Migrations; cria `admin` se não houver administrador | Não altera admin existente |
| 6. Inicialização | Windows: tarefa agendada **MotoControl** (boot, conta SYSTEM, reinício em falha), regra de firewall só para a sub-rede local, atalhos. Linux: unidade systemd `motocontrol`, `ufw` se ativo. Opcional: desativar suspensão | Recria/atualiza |
| 7. Verificação | Aguarda `/api/health`, mostra os endereços na rede e gera `MotoControl (outros computadores).url` | Regera |

Opções: `--yes` (sem perguntas), `--port=N`, `--db-name=nome`, `--no-service`, `--no-shortcuts`, `--reinstall-deps`. Variáveis para `--yes`: `PG_SUPERUSER`, `PG_SUPERUSER_PASSWORD`, `PG_HOST`, `PG_PORT`, `ADMIN_PASSWORD`.

**Senha do superusuário do PostgreSQL**, em ordem de prioridade: variável `PG_SUPERUSER_PASSWORD` → arquivo `postgres-superusuario.txt` (de instalações antigas ou do modo `--yes`) → pergunta ao usuário, explicando qual senha é. No Linux como root não é usada (autenticação local via `runuser -u postgres`).

### O que o instalador cria no Windows

| Item | Onde |
|---|---|
| Tarefa agendada | Agendador de Tarefas → **MotoControl** (executa `iniciar-motocontrol.bat`, gerado na pasta) |
| Firewall | Regra de entrada **MotoControl**, TCP na porta configurada, `remoteip=localsubnet` |
| Atalhos | Área de trabalho pública e menu Iniciar → MotoControl (Abrir / Parar) |
| Log do servidor | `motocontrol.log` na pasta do sistema |
| Senha do PostgreSQL | Definida pelo usuário durante a instalação e **não gravada**. Só no modo `--yes` (senha gerada) vai para `postgres-superusuario.txt` |

## Controle do serviço — `scripts/control.js`

`iniciar.bat`/`parar.bat` chamam `control.js start|stop`. Ele detecta como o servidor está configurado: tarefa agendada (Windows), unidade systemd (Linux) ou processo em segundo plano (usando `motocontrol.pid`, gravado pelo `app.js`). O estado é conferido pelo `/api/health`.

## Variáveis do `.env`

| Variável | Padrão | Uso |
|---|---|---|
| `NODE_ENV` | `development` | Em `production`, `SESSION_SECRET` é obrigatório |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Endereço do servidor |
| `DATABASE_URL` | — | Conexão com o PostgreSQL |
| `SESSION_SECRET` | — | Assinatura do cookie de sessão. Trocar invalida todas as sessões |
| `SESSION_MAX_AGE_HOURS` | `12` | Expiração por inatividade |
| `BACKUP_DIR` | `./backups` | Pasta dos backups |
| `BACKUP_INTERVAL_HOURS` | `24` | Intervalo do backup automático (`0` desativa) |
| `BACKUP_KEEP` | `30` | Quantos backups manter |
| `PG_DUMP_PATH` / `PG_RESTORE_PATH` | do PATH | Caminho dos utilitários do PostgreSQL |

## Instalação manual (sem o instalador)

1. Crie o banco:
   ```sql
   CREATE ROLE motocontrol LOGIN PASSWORD 'senha-forte';
   CREATE DATABASE motocontrol OWNER motocontrol;
   ```
2. `npm ci --omit=dev`
3. Copie `.env.example` para `.env` e preencha `DATABASE_URL`, `SESSION_SECRET` e `ADMIN_PASSWORD`.
4. `npm run seed` e `npm start`.

### Inicialização automática manual — Linux (systemd)

`/etc/systemd/system/motocontrol.service`:
```ini
[Unit]
Description=MotoControl - gerenciamento de oficina
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=motocontrol
WorkingDirectory=/opt/motocontrol
ExecStart=/usr/bin/node app.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now motocontrol
```

### Inicialização automática manual — Windows (alternativa com NSSM)

Se o Agendador de Tarefas não for opção, registre como serviço com o [NSSM](https://nssm.cc/), em um Prompt **como administrador**:
```bat
C:\nssm\nssm.exe install MotoControl "C:\Program Files\nodejs\node.exe" "C:\MotoControl\app.js"
C:\nssm\nssm.exe set MotoControl AppDirectory "C:\MotoControl"
C:\nssm\nssm.exe set MotoControl AppStdout "C:\MotoControl\motocontrol.log"
C:\nssm\nssm.exe set MotoControl AppStderr "C:\MotoControl\motocontrol.log"
C:\nssm\nssm.exe start MotoControl
netsh advfirewall firewall add rule name="MotoControl" dir=in action=allow protocol=TCP localport=3000 remoteip=localsubnet
```

## Diagnóstico

| Onde olhar | Windows | Linux |
|---|---|---|
| Log do servidor | `motocontrol.log` | `journalctl -u motocontrol -n 100` |
| Está rodando? | `node scripts\control.js status` | `node scripts/control.js status` |
| Tarefa / serviço | `schtasks /Query /TN MotoControl /V` | `systemctl status motocontrol` |
| PostgreSQL | `services.msc` → postgresql | `systemctl status postgresql` |
