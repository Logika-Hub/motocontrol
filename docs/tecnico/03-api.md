# API REST

Base: `http://<servidor>:3000/api`. JSON em requisições e respostas. Autenticação por cookie de sessão (`motocontrol.sid`), obtido em `POST /auth/login`.

## Convenções

| Situação | Resposta |
|---|---|
| Sucesso | `200` (consulta/alteração), `201` (criação), `204` (sem corpo) |
| Erro | `{ "error": "mensagem em português", "details": { ... } }` |
| Dados inválidos | `400` — `details.missing` lista campos obrigatórios ausentes |
| Não autenticado / sessão expirada | `401` |
| Sem permissão | `403` |
| Não encontrado | `404` |
| Conflito (duplicidade, regra de negócio, versão) | `409` — em conflito de versão, `details.currentVersion` |
| Muitas tentativas de login | `429` |

**Listas paginadas** aceitam `page` e `limit` (padrão 25, máx. 100) e devolvem `{ page, limit, total, items }`.

**Concorrência:** as ações que alteram a comanda (`PATCH`, `/status`, `/finish`, `/cancel`) exigem `version` — a que o cliente recebeu por último. Versão diferente → `409`.

## Endpoints

Permissão: ver [`server/config/permissions.js`](../../server/config/permissions.js). `—` = qualquer usuário autenticado.

### Autenticação

| Método | Rota | Corpo | Permissão |
|---|---|---|---|
| POST | `/auth/login` | `{username, password}` | pública |
| POST | `/auth/logout` | | pública |
| GET | `/auth/me` | | — |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` | — |
| GET | `/health` | | pública |

### Dashboard

| Método | Rota | Resposta | Permissão |
|---|---|---|---|
| GET | `/dashboard` | `{counts, latest, activity}` | `dashboard:read` |

### Clientes

| Método | Rota | Corpo / parâmetros | Permissão |
|---|---|---|---|
| GET | `/customers` | `?q=` (nome, telefone, CPF) | `customers:read` |
| GET | `/customers/:id` | inclui `motorcycles` e `workOrders` | `customers:read` |
| POST | `/customers` | `{name, phone, cpf?, address?, notes?}` | `customers:write` |
| PUT | `/customers/:id` | idem | `customers:write` |
| DELETE | `/customers/:id` | só sem comandas e sem motos | `customers:delete` |

### Motocicletas

| Método | Rota | Corpo / parâmetros | Permissão |
|---|---|---|---|
| GET | `/motorcycles` | `?q=` (placa, modelo, marca, dono), `?customerId=` | `motorcycles:read` |
| GET | `/motorcycles/:id` | inclui `history` (comandas com itens) | `motorcycles:read` |
| POST | `/motorcycles` | `{customerId, brand, model, year, plate, color?, currentKm?, notes?}` | `motorcycles:write` |
| PUT | `/motorcycles/:id` | idem (trocar `customerId` transfere o dono) | `motorcycles:write` |
| DELETE | `/motorcycles/:id` | só sem comandas | `motorcycles:delete` |

### Comandas

| Método | Rota | Corpo / parâmetros | Permissão |
|---|---|---|---|
| GET | `/work-orders` | `?number=&plate=&customer=&model=&status=a,b&userId=&motorcycleId=&from=AAAA-MM-DD&to=` | `work_orders:read` |
| GET | `/work-orders/:id` | comanda completa: dados, `items`, `updates` | `work_orders:read` |
| POST | `/work-orders` | `{motorcycleId, customerId?, complaint, entryKm?, expectedDelivery?, notes?}` | `work_orders:create` |
| PATCH | `/work-orders/:id` | `{version, complaint?, entryKm?, expectedDelivery?}` (recepção) `{identifiedProblems?, diagnosis?}` (técnico) `{notes?}` | `edit_reception` / `edit_technical` por campo |
| POST | `/work-orders/:id/status` | `{status, version, note?}` — só estados ativos | `work_orders:status` |
| POST | `/work-orders/:id/finish` | `{version, closingNotes?}` | `work_orders:finish` |
| POST | `/work-orders/:id/cancel` | `{version, reason}` | `work_orders:cancel` |
| POST | `/work-orders/:id/updates` | `{type: observacao\|diagnostico\|servico, description}` | `note` ou `diagnosis` conforme o tipo |
| POST | `/work-orders/:id/updates/:uid/correct` | `{description}` — autor ou admin | `note`/`diagnosis` |
| DELETE | `/work-orders/:id/updates/:uid` | `{reason}` | `work_orders:remove_update` |
| POST | `/work-orders/:id/items` | `{kind: servico\|peca, description, quantity?}` | `work_orders:items` |
| POST | `/work-orders/:id/items/:itemId/done` | | `work_orders:items` |
| DELETE | `/work-orders/:id/items/:itemId` | | `work_orders:items` |

Todas as ações de comanda devolvem a comanda completa atualizada.

### Funcionários

| Método | Rota | Corpo | Permissão |
|---|---|---|---|
| GET | `/users`, `/users/roles` | | `users:manage` |
| POST | `/users` | `{name, username, role, password}` | `users:manage` |
| PATCH | `/users/:id` | `{name?, role?, active?}` | `users:manage` |
| POST | `/users/:id/reset-password` | `{password}` | `users:manage` |

### Administração

| Método | Rota | Permissão |
|---|---|---|
| GET | `/admin/staff` (lista de funcionários para filtros) | `work_orders:read` |
| GET | `/admin/audit?entity=&userId=` | `audit:read` |
| GET / POST | `/admin/backups` (listar / gerar) | `backups:manage` |
| GET | `/admin/backups/:arquivo` (download) | `backups:manage` |
| PUT | `/admin/branding` `{name, logo?}` — `logo`: data URL PNG/JPEG/WEBP (≤ 512 KB), `null` remove, ausente mantém | `settings:manage` (só admin) |

### Identidade da oficina (pública, fora de `/api`)

| Método | Rota | Resposta |
|---|---|---|
| GET | `/marca` | `{name, hasLogo, version}` |
| GET | `/marca/logo` | A imagem (com `ETag`; 404 se não houver logo) |

## Exemplo com `curl`

```bash
curl -c cookie.txt -H 'Content-Type: application/json' \
  -d '{"username":"joao","password":"demo123"}' http://localhost:3000/api/auth/login
```
```bash
curl -b cookie.txt 'http://localhost:3000/api/work-orders?status=aguardando_pecas'
```
