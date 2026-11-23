# Banco de dados

PostgreSQL 14+. Estrutura definida em [`database/migrations/001_initial_schema.sql`](../../database/migrations/001_initial_schema.sql); [`002_shop_settings.sql`](../../database/migrations/002_shop_settings.sql) acrescenta a identidade da oficina; [`003_shop_setup_done.sql`](../../database/migrations/003_shop_setup_done.sql), a marca de configuração inicial.

## Diagrama

```
 roles 1───N users 1───N (created_by / opened_by / user_id / ...) em quase todas as tabelas

 customers 1───N motorcycles 1───N work_orders 1───N work_order_items
     │                                  │
     └──────────────N───────────────────┤
                                        └──────N work_order_updates ──┐
                                                       ▲              │ corrects_update_id
                                                       └──────────────┘
 audit_logs   (user_id opcional; registra operações de todo o sistema)
 shop_settings (linha única: nome e logo)
 user_sessions (sessões de login)      schema_migrations (controle de migrations)
```

## Tabelas

| Tabela | Conteúdo | Observações |
|---|---|---|
| `roles` | Perfis (`admin`, `atendente`, `mecanico`, `consulta`) | Fixos, inseridos pela migration |
| `users` | Funcionários | `username` único sem diferenciar maiúsculas; `active`; `must_change_password` |
| `customers` | Clientes | `phone` e `cpf` só dígitos; CPF único entre não excluídos; `deleted_at` |
| `motorcycles` | Motos | `plate` normalizada (7 caracteres) e única entre não excluídas; `current_km`; `deleted_at` |
| `work_orders` | Comandas | `number` da sequence; `status` com `CHECK`; `version`; dados de abertura/fechamento; `cancel_reason` |
| `work_order_items` | Serviços e peças | `kind` (`servico`/`peca`), `status` (`solicitado`/`realizado`), `performed_by`, `removed_at` |
| `work_order_updates` | Linha do tempo | `type`, `description`, `from_status`/`to_status`, `corrects_update_id`, `metadata` (JSONB), `removed_*` |
| `audit_logs` | Auditoria | `action`, `entity`, `entity_id`, `details` (JSONB), `ip` |
| `shop_settings` | Nome e logo da oficina | Linha única (`id = 1`); `logo` `BYTEA` + `logo_mime` (png/jpeg/webp), ambos nulos ou ambos preenchidos; `setup_done_at` nulo = configuração do primeiro acesso pendente |
| `user_sessions` | Sessões | Usada por `connect-pg-simple` |
| `schema_migrations` | Migrations aplicadas | Criada por `migrate.js` |

## Restrições que garantem regras de negócio

- `ON DELETE RESTRICT` em todas as chaves estrangeiras (RN10).
- `CHECK (status <> 'cancelada' OR (cancel_reason IS NOT NULL AND closed_by IS NOT NULL))` (RN11).
- `CHECK (status <> 'concluida' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL))`.
- Índices únicos parciais `WHERE deleted_at IS NULL` para placa e CPF — uma placa pode voltar a ser cadastrada depois que o cadastro antigo foi excluído.

## Índices de busca

Nome do cliente (`lower(name)`), telefone, placa, modelo (`lower(model)`), status, abertura (`opened_at DESC`), moto, cliente e autor da comanda, linha do tempo por comanda e por data. Cobrem os filtros da tela de consulta e o Dashboard.

## Migrations

- Arquivos `database/migrations/NNN_descricao.sql`, aplicados **em ordem** e **uma única vez**, cada um em transação.
- Aplicados automaticamente quando o servidor inicia e pelo instalador. Manualmente: `npm run migrate`.
- `pg_advisory_lock` impede duas instâncias de migrar ao mesmo tempo.

### Criando uma migration

1. Crie `database/migrations/002_descricao_curta.sql` (próximo número).
2. Escreva SQL **compatível com dados existentes** — oficinas já instaladas vão aplicá-la sobre dados reais:
   - nova coluna obrigatória → adicione com `DEFAULT` ou em três passos (adicionar nula, preencher, `SET NOT NULL`);
   - nunca edite uma migration já publicada; crie outra.
3. Rode `npm test` (os testes recriam o banco do zero aplicando todas as migrations).
4. Teste também sobre uma cópia de banco com dados (`npm run seed:demo` antes da migration).

## Consultas úteis (suporte)

```sql
-- Comandas em andamento há mais de 7 dias
SELECT number, status, opened_at FROM work_orders
 WHERE status NOT IN ('concluida','cancelada') AND opened_at < now() - interval '7 days';

-- O que um funcionário registrou hoje
SELECT w.number, u.type, u.description, u.created_at
  FROM work_order_updates u JOIN work_orders w ON w.id = u.work_order_id
 WHERE u.user_id = (SELECT id FROM users WHERE username = 'carlos') AND u.created_at >= current_date;

-- Recuperar acesso do admin (definir senha provisória "trocar123" — exige troca no próximo login)
-- Gere o hash com: node -e "console.log(require('bcryptjs').hashSync('trocar123', 10))"
UPDATE users SET password_hash = '<hash>', must_change_password = TRUE, active = TRUE WHERE username = 'admin';
```
