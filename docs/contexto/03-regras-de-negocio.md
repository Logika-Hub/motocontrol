# Regras de negócio

Rastreabilidade de cada regra: **onde está implementada** e **qual teste a garante** (`tests/api.test.js`). Ao alterar uma regra, atualize esta tabela.

## Regras do briefing

| Código | Regra | Implementação | Teste |
|---|---|---|---|
| RN01 | Número de comanda único e sequencial | `work_order_number_seq` (migration 001); formato em `services/workOrders.js#formatNumber` | *aberturas simultâneas geram números únicos* |
| RN02 | Comanda vinculada a cliente cadastrado | FK `work_orders.customer_id`; `create` valida que a moto pertence ao cliente | *comanda é criada com número sequencial...* |
| RN03 | Comanda vinculada a moto cadastrada | FK `work_orders.motorcycle_id` | idem |
| RN04 | Moto com várias comandas, histórico preservado | Relação 1:N; `GET /api/motorcycles/:id` retorna `history` | *conclusão exige serviços realizados...* |
| RN05 | Registrar quem abriu | `opened_by` = usuário da sessão; registro `abertura` na linha do tempo | *comanda é criada...* |
| RN06 | Toda atualização registra usuário e horário automaticamente | `addUpdate` usa `req.user.id`; `created_at DEFAULT now()`; corpo da requisição ignorado | *mecânicos diferentes registram...* (tenta forjar `user_id`/`created_at`) |
| RN07 | Vários mecânicos na mesma comanda | Linha do tempo e itens sem restrição de autor | idem |
| RN08 | Mudança de status registrada | `changeStatus`/`finish`/`cancel` gravam `from_status`/`to_status` | *mecânicos diferentes...*, *cancelamento...* |
| RN09 | Concluída continua consultável | Estados finais imutáveis (`lockOrder`), sem exclusão | *conclusão exige...* |
| RN10 | Não excluir cliente/moto com comandas | `DELETE` verifica relacionamentos; FKs `RESTRICT`; exclusão lógica | *cliente e moto com comandas não podem ser excluídos* |
| RN11 | Cancelamento registra responsável e justificativa | `cancel` exige `reason`; `CHECK` no banco | *cancelamento exige justificativa...* |
| RN12 | Uso simultâneo sem sobrescrita | `version` + `SELECT ... FOR UPDATE` em transação | *edição concorrente com versão desatualizada é recusada* |

## Regras do histórico (briefing 4.6)

| Regra | Implementação |
|---|---|
| Registro associado ao usuário autenticado | `addUpdate(db, id, user.id, ...)` |
| Data/hora gerada pelo servidor | `created_at DEFAULT now()` |
| Registros anteriores preservados | Nenhuma rota faz `UPDATE` de texto em `work_order_updates` |
| Correções mantêm o histórico | `correctUpdate` cria registro `correcao` com `corrects_update_id` e o texto original em `metadata` |
| Exclusão restrita e auditada | `removeUpdate`: permissão `work_orders:remove_update` (só admin), motivo obrigatório, marca `removed_at`, grava `audit_logs` |

## Regras adicionais (decisões do projeto, não do briefing)

| Regra | Onde | Motivo |
|---|---|---|
| Uma comanda em andamento por moto | `workOrders.create` | [D08](02-decisoes.md#d08--uma-comanda-em-andamento-por-moto) |
| Concluir exige serviços realizados | `workOrders.finish` | [D09](02-decisoes.md#d09--concluir-exige-serviços-realizados) |
| Sem reabertura de comanda | `lockOrder` | [D10](02-decisoes.md#d10--comanda-concluídacancelada-é-imutável-sem-reabertura) |
| Só autor ou admin corrige um registro | `correctUpdate` | Responsabilização individual |
| Registros automáticos (status, abertura...) não são corrigíveis | `correctUpdate`/`removeUpdate` | São fatos gerados pelo sistema |
| Km de entrada maior que a atual atualiza a moto | `workOrders.create` | Manter `current_km` sem digitação dupla |
| CPF validado (dígitos verificadores) e único | `lib/validation.js#normalizeCpf`, índice parcial | Qualidade do cadastro |
| Placa normalizada (antiga ou Mercosul), única entre motos ativas | `normalizePlate`, índice parcial | Placa é o principal identificador (briefing 4.4) |
| Login bloqueado 5 min após 5 erros | `routes/auth.js` | Força bruta |
| Senha inicial/redefinida exige troca | `must_change_password` | Administrador não deve conhecer a senha final |
| Admin não desativa nem rebaixa a si mesmo | `routes/users.js` | Evitar ficar sem administrador |
| Chamado só em comanda em andamento; mensagens imutáveis; encerrar exige resumo (vai à linha do tempo); concluir/cancelar encerra os abertos | `services/tickets.js` | [D18](02-decisoes.md#d18--chamados-chat-dentro-da-comanda) |

## Fluxo de status

```
            ┌──────────────────────────────────────────────┐
            │  livre entre os quatro estados "ativos"       │
  abertura  ▼                                               │
 ───────► Aberta ⇄ Em diagnóstico ⇄ Aguardando peças ⇄ Em execução
            │              │                │                │
            └──────────────┴───── Concluir ─┴────────────────┴──► Concluída  (final)
            └──────────────┴───── Cancelar ─┴────────────────┴──► Cancelada  (final, exige justificativa)
```

Concluir e cancelar têm ações próprias (`/finish`, `/cancel`); `/status` só aceita os quatro estados ativos.

## Regras financeiras (D19)

Testes em `tests/finance.test.js` (integração) e `tests/saleCalc.test.js` (cálculo).

| Código | Regra | Implementação | Teste |
|---|---|---|---|
| RN13 | Só comanda concluída e com preço em todos os itens vira venda | `services/sales.js#closingData`/`close` | *comanda cancelada não gera venda; item sem preço...* |
| RN14 | Comanda não pode ser fechada duas vezes | `sales_one_active_per_order_uq` + `FOR UPDATE` | *uma comanda não pode ser fechada duas vezes* |
| RN15 | Soma dos pagamentos = total da venda | `saleCalc#validatePayments` (no servidor, dentro da transação); `CHECK`s de totais em `sales`/`sale_items` | *fechamento...*; *integridade no banco* confere no banco que a soma dos pagamentos = total |
| RN16 | Desconto rateado proporcionalmente; comissão sobre o líquido | `saleCalc#distributeDiscount`, `commissionFor` | *saleCalc.test.js*, *fechamento...* |
| RN17 | Regra nova vale só para fechamentos futuros | retrato em `sale_items`; `commission_rules.ended_at` | *regra nova vale só para fechamentos futuros* |
| RN18 | Repasse nunca excede o saldo pendente; parcial permitido | `services/commissions.js#createPayout` (trava o usuário) | *repasses: totais e parciais...* |
| RN19 | Estorno e cancelamento de repasse exigem motivo, preservam o registro e são auditados | `voidSale`, `cancelPayout`, `audit()` | *estorno...*, *cancelar repasse...* |
| RN20 | Colaborador só vê os próprios dados financeiros | `/finance/me/*` usa `req.user.id` | *painel individual...*, *permissões...* |
| RN21 | Comissões só aparecem para administradores | `sales.js#preview`/`getSale` filtram sem `finance:admin` | *permissões...* |
