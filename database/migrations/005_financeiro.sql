-- Financeiro (D19): fechamento de comanda em venda, pagamentos, comissões e repasses a colaboradores.
-- Valores em NUMERIC(12,2) (reais). Todo cálculo é feito no servidor; nada aqui é apagado (estorno/cancelamento = marcação).

-- Preço unitário do item (opcional enquanto a comanda está aberta; obrigatório no fechamento).
ALTER TABLE work_order_items ADD COLUMN unit_price NUMERIC(12,2) CHECK (unit_price >= 0);

-- Fechamento e estorno aparecem na linha do tempo da comanda.
ALTER TABLE work_order_updates DROP CONSTRAINT work_order_updates_type_check;
ALTER TABLE work_order_updates ADD CONSTRAINT work_order_updates_type_check CHECK (type IN
  ('abertura','status','diagnostico','servico','peca','observacao','edicao','correcao','finalizacao','cancelamento','remocao','chamado','venda'));

-- Regras de comissão. user_id nulo = regra padrão da oficina. Regras nunca são editadas:
-- mudar = encerrar a vigente (ended_at) e criar outra, preservando o histórico.
CREATE TABLE commission_rules (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER       REFERENCES users(id) ON DELETE RESTRICT,
  type        VARCHAR(10)   NOT NULL CHECK (type IN ('percentual','fixo')),
  value       NUMERIC(12,2) NOT NULL CHECK (value >= 0),
  created_by  INTEGER       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  ended_by    INTEGER       REFERENCES users(id) ON DELETE RESTRICT,
  ended_at    TIMESTAMPTZ,
  CHECK (type <> 'percentual' OR value <= 100)
);
-- No máximo uma regra vigente por colaborador (e uma padrão).
CREATE UNIQUE INDEX commission_rules_active_uq ON commission_rules (COALESCE(user_id, 0)) WHERE ended_at IS NULL;

-- Venda = fechamento oficial de uma comanda concluída.
CREATE TABLE sales (
  id             SERIAL PRIMARY KEY,
  work_order_id  INTEGER       NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  status         VARCHAR(10)   NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida','estornada')),
  subtotal       NUMERIC(12,2) NOT NULL CHECK (subtotal > 0),
  discount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total          NUMERIC(12,2) NOT NULL CHECK (total > 0),
  notes          TEXT,
  closed_by      INTEGER       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  closed_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  voided_by      INTEGER       REFERENCES users(id) ON DELETE RESTRICT,
  voided_at      TIMESTAMPTZ,
  void_reason    TEXT,
  CHECK (discount < subtotal AND total = subtotal - discount),
  CHECK (status <> 'estornada' OR (voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
-- Uma comanda não pode ter duas vendas ativas (um estorno libera um novo fechamento, com rastro).
CREATE UNIQUE INDEX sales_one_active_per_order_uq ON sales (work_order_id) WHERE status = 'concluida';
CREATE INDEX sales_closed_at_idx ON sales (closed_at DESC);
CREATE INDEX sales_work_order_idx ON sales (work_order_id);
CREATE INDEX sales_closed_by_idx ON sales (closed_by);

-- Itens da venda: retrato (snapshot) dos valores e da comissão no momento do fechamento.
CREATE TABLE sale_items (
  id                  SERIAL PRIMARY KEY,
  sale_id             INTEGER       NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  work_order_item_id  INTEGER       NOT NULL REFERENCES work_order_items(id) ON DELETE RESTRICT,
  kind                VARCHAR(10)   NOT NULL CHECK (kind IN ('servico','peca')),
  description         VARCHAR(255)  NOT NULL,
  quantity            NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price          NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  gross_amount        NUMERIC(12,2) NOT NULL CHECK (gross_amount >= 0),
  discount_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  net_amount          NUMERIC(12,2) NOT NULL CHECK (net_amount >= 0),
  user_id             INTEGER       REFERENCES users(id) ON DELETE RESTRICT,   -- responsável (só serviços)
  commission_type     VARCHAR(10)   CHECK (commission_type IN ('percentual','fixo')),
  commission_value    NUMERIC(12,2),                                           -- % ou R$ vigentes no fechamento
  commission_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  CHECK (kind = 'servico' OR (user_id IS NULL AND commission_amount = 0)),
  CHECK (net_amount = gross_amount - discount_amount)
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX sale_items_user_idx ON sale_items (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX sale_items_wo_item_idx ON sale_items (work_order_item_id);

-- Formas de pagamento da venda (pode haver várias; a soma é igual ao total).
CREATE TABLE sale_payments (
  id       SERIAL PRIMARY KEY,
  sale_id  INTEGER       NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  method   VARCHAR(10)   NOT NULL CHECK (method IN ('pix','dinheiro','credito','debito')),
  amount   NUMERIC(12,2) NOT NULL CHECK (amount > 0)
);
CREATE INDEX sale_payments_sale_idx ON sale_payments (sale_id);

-- Repasses (pagamentos) feitos ao colaborador, totais ou parciais. Cancelar = marcar, nunca apagar.
CREATE TABLE commission_payouts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method        VARCHAR(15)   NOT NULL CHECK (method IN ('pix','dinheiro','transferencia','outro')),
  note          TEXT,
  status        VARCHAR(10)   NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','cancelado')),
  paid_by       INTEGER       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  paid_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  cancelled_by  INTEGER       REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT,
  CHECK (status <> 'cancelado' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX commission_payouts_user_idx ON commission_payouts (user_id, paid_at DESC);
CREATE INDEX commission_payouts_paid_at_idx ON commission_payouts (paid_at DESC);
