# MotoControl

Sistema web de gerenciamento de oficinas de motocicletas — **v1.0 (MVP)**. Roda em um computador da oficina (servidor local) e é acessado pelos demais computadores da rede pelo navegador, sem depender de internet.

A **comanda** (ordem de serviço) é o centro do sistema: recebimento da moto, diagnóstico, serviços, peças, status e uma linha do tempo em que cada registro fica associado ao funcionário que o fez, com data e hora geradas pelo servidor.

Referência: [Briefing técnico v1.0](docs/MotoControl_Briefing_Tecnico_v1.0.pdf).

## Funcionalidades (escopo do MVP)

| Módulo | O que faz |
|---|---|
| Autenticação | Login individual, sessão no banco, troca obrigatória da senha inicial, bloqueio temporário após 5 tentativas erradas |
| Funcionários | Cadastro, edição, perfil, ativação/desativação (efeito imediato) e redefinição de senha pelo administrador |
| Dashboard | Contadores por status, comandas atrasadas, últimas comandas e atividades recentes |
| Clientes | Cadastro com validação de CPF, busca por nome/telefone/CPF, motos e comandas vinculadas |
| Motocicletas | Cadastro com placa normalizada (antiga e Mercosul), busca por placa/modelo/proprietário, histórico de manutenção |
| Comandas | Numeração `OS-000001` sequencial, status, serviços e peças, diagnóstico, edição com registro do valor anterior, conclusão e cancelamento com justificativa, impressão |
| Linha do tempo | Registros imutáveis; correções geram novo registro ligado ao original; remoção só pelo administrador, com motivo e auditoria |
| Consulta | Filtros por número, placa, cliente, modelo, funcionário, status e período |
| Administração | Auditoria das operações, backup manual/automático e download dos backups |

**Fora do escopo desta versão:** financeiro, estoque, compras, orçamentos, notas fiscais, WhatsApp, multifilial e acesso pela internet.

### Perfis e permissões

As permissões são verificadas no back-end em todas as rotas (`server/config/permissions.js`); a interface apenas esconde o que o perfil não pode fazer.

| Ação | Administrador | Atendente | Mecânico | Consulta |
|---|:-:|:-:|:-:|:-:|
| Ver dashboard, clientes, motos e comandas | ✓ | ✓ | ✓ | ✓ |
| Cadastrar/editar clientes e motos | ✓ | ✓ | | |
| Excluir clientes e motos (sem comandas) | ✓ | | | |
| Abrir comanda; editar reclamação, km e previsão | ✓ | ✓ | | |
| Editar diagnóstico e problemas identificados | ✓ | | ✓ | |
| Registrar diagnóstico/serviço na linha do tempo | ✓ | | ✓ | |
| Registrar observação | ✓ | ✓ | ✓ | |
| Adicionar/realizar serviços e peças | ✓ | | ✓ | |
| Alterar status e concluir comanda | ✓ | ✓ | ✓ | |
| Cancelar comanda | ✓ | ✓ | | |
| Remover registro do histórico | ✓ | | | |
| Funcionários, auditoria e backups | ✓ | | | |

### Regras de negócio implementadas

- **RN01** número gerado por *sequence* do PostgreSQL — único mesmo com aberturas simultâneas.
- **RN02/RN03** comanda exige moto cadastrada; o cliente é o proprietário da moto (validado).
- **RN04/RN09** comandas concluídas e canceladas ficam imutáveis e disponíveis no histórico da moto.
- **RN05/RN06/RN07** autor e horário de cada registro vêm da sessão e do servidor, nunca do formulário.
- **RN08** toda mudança de status entra na linha do tempo.
- **RN10** clientes e motos com comandas não podem ser excluídos (exclusão sempre lógica).
- **RN11** cancelamento exige justificativa e registra o responsável.
- **RN12** controle de concorrência otimista: cada comanda tem `version`; uma edição baseada em versão desatualizada é recusada (HTTP 409) e a tela recarrega os dados.
- Uma moto não pode ter duas comandas em andamento ao mesmo tempo.
- Para concluir, todos os serviços da comanda devem estar marcados como realizados (ou removidos).

## Tecnologias

Node.js 20+ · Express 4 · PostgreSQL 14+ · API REST · sessões em PostgreSQL (`connect-pg-simple`) · senhas com bcrypt · front-end em HTML/CSS/JavaScript puro (módulos ES, sem etapa de build).

## Instalação no servidor da oficina

Pré-requisitos: [Node.js 20 LTS ou superior](https://nodejs.org/) e [PostgreSQL](https://www.postgresql.org/download/) no computador que será o servidor.

1. Crie o banco (no `psql` ou pgAdmin):
   ```sql
   CREATE ROLE motocontrol LOGIN PASSWORD 'uma-senha-forte';
   CREATE DATABASE motocontrol OWNER motocontrol;
   ```
2. Copie o projeto para o servidor e instale as dependências:
   ```bash
   npm ci --omit=dev
   ```
3. Copie `.env.example` para `.env` e preencha `DATABASE_URL`, `SESSION_SECRET` e `ADMIN_PASSWORD`.
4. Crie as tabelas e o usuário administrador:
   ```bash
   npm run seed
   ```
5. Inicie:
   ```bash
   npm start
   ```
6. Nos outros computadores, acesse `http://IP-DO-SERVIDOR:3000` (ex.: `http://192.168.0.100:3000`). Reserve um IP fixo para o servidor no roteador.

Para iniciar automaticamente com o sistema operacional: [`deploy/motocontrol.service`](deploy/motocontrol.service) (Linux/systemd) ou [`deploy/windows-servico.md`](deploy/windows-servico.md) (Windows).

As migrations são aplicadas automaticamente a cada inicialização (`database/migrations/`).

## Backup e restauração

- **Automático:** a cada `BACKUP_INTERVAL_HOURS` (padrão 24 h), mantendo os `BACKUP_KEEP` mais recentes em `BACKUP_DIR`.
- **Manual:** `npm run backup` ou o botão em *Administração*.
- **Restaurar:** pare o servidor e execute `npm run restore -- <arquivo.dump>` (antes de restaurar, é feito um backup de segurança do estado atual). `npm run restore -- --list` lista os backups.

Os backups ficam no mesmo computador. **Copie-os regularmente para um pendrive ou HD externo**: se o disco do servidor falhar, backups locais se perdem junto.

## Desenvolvimento

```bash
npm install
cp .env.example .env        # ajuste DATABASE_URL; NODE_ENV=development dispensa SESSION_SECRET
npm run seed:demo           # admin/admin123 + funcionários de exemplo (senha demo123)
npm run dev                 # reinicia ao salvar
```

Usuários de demonstração: `joao` (atendente), `carlos` e `paulo` (mecânicos), `ana` (consulta).

### Testes

Os testes de integração exercitam a API contra um banco real e cobrem os critérios de aceitação do briefing (contas individuais, permissões, autoria dos registros, concorrência, numeração, histórico, cancelamento, backup e restauração).

```bash
createdb motocontrol_test   # uma vez
npm test                    # usa TEST_DATABASE_URL ou postgres://motocontrol:motocontrol@localhost:5432/motocontrol_test
```

### Estrutura

```
app.js                    servidor Express (API + arquivos estáticos)
server/
  config/                 variáveis de ambiente, conexão, matriz de permissões
  middlewares/            autenticação/autorização e tratamento de erros
  routes/                 endpoints REST (/api/...)
  services/               regras de negócio (comandas, auditoria, backup)
database/
  migrations/             SQL versionado
  seeds/                  administrador inicial e dados de demonstração
client/
  index.html              aplicação de página única (rotas com #)
  pages/                  uma tela por arquivo
  scripts/                API, utilitários de interface, formulários
  styles/
scripts/                  backup e restauração via linha de comando
deploy/                   inicialização automática (Linux e Windows)
tests/                    testes de integração
```

### Principais endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` · `/logout` · `/change-password` | Sessão |
| GET | `/api/dashboard` | Indicadores e atividades recentes |
| GET/POST/PUT/DELETE | `/api/customers[/:id]` | Clientes |
| GET/POST/PUT/DELETE | `/api/motorcycles[/:id]` | Motocicletas (+ histórico em `GET /:id`) |
| GET/POST/PATCH | `/api/work-orders[/:id]` | Comandas (filtros: `number, plate, customer, model, status, userId, from, to`) |
| POST | `/api/work-orders/:id/status` · `/finish` · `/cancel` | Fluxo da comanda (exigem `version`) |
| POST | `/api/work-orders/:id/updates` · `/updates/:uid/correct` | Linha do tempo |
| DELETE | `/api/work-orders/:id/updates/:uid` | Remoção auditada (admin) |
| POST/DELETE | `/api/work-orders/:id/items[/:itemId[/done]]` | Serviços e peças |
| GET/POST/PATCH | `/api/users[/:id]` · `/:id/reset-password` | Funcionários (admin) |
| GET/POST | `/api/admin/audit` · `/api/admin/backups` | Auditoria e backups (admin) |
