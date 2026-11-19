-- MotoControl — esquema inicial (v1.0 MVP)
-- Convenções: exclusão lógica (deleted_at / active), timestamps gerados pelo servidor,
-- integridade referencial com ON DELETE RESTRICT (RN10).

CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,   -- admin | atendente | mecanico | consulta
  name        VARCHAR(50)  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  role_id        INTEGER      NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  name           VARCHAR(120) NOT NULL,
  username       VARCHAR(50)  NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  active         BOOLEAN      NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));

CREATE TABLE customers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  phone       VARCHAR(20)  NOT NULL,
  cpf         VARCHAR(11),                    -- somente dígitos
  address     TEXT,
  notes       TEXT,
  created_by  INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX customers_cpf_uq ON customers (cpf) WHERE cpf IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX customers_name_idx  ON customers (lower(name));
CREATE INDEX customers_phone_idx ON customers (phone);

CREATE TABLE motorcycles (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER      NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  brand        VARCHAR(50)  NOT NULL,
  model        VARCHAR(80)  NOT NULL,
  year         SMALLINT     NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  plate        VARCHAR(7)   NOT NULL,         -- normalizada: maiúsculas, sem hífen
  color        VARCHAR(30),
  current_km   INTEGER      CHECK (current_km >= 0),
  notes        TEXT,
  created_by   INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX motorcycles_plate_uq ON motorcycles (plate) WHERE deleted_at IS NULL;
CREATE INDEX motorcycles_customer_idx ON motorcycles (customer_id);
CREATE INDEX motorcycles_model_idx    ON motorcycles (lower(model));

-- RN01: número sequencial gerado pelo banco (seguro sob concorrência).
CREATE SEQUENCE work_order_number_seq START 1;

CREATE TABLE work_orders (
  id                 SERIAL PRIMARY KEY,
  number             INTEGER      NOT NULL UNIQUE DEFAULT nextval('work_order_number_seq'),
  customer_id        INTEGER      NOT NULL REFERENCES customers(id)   ON DELETE RESTRICT,  -- RN02
  motorcycle_id      INTEGER      NOT NULL REFERENCES motorcycles(id) ON DELETE RESTRICT,  -- RN03
  status             VARCHAR(20)  NOT NULL DEFAULT 'aberta'
                     CHECK (status IN ('aberta','em_diagnostico','aguardando_pecas','em_execucao','concluida','cancelada')),
  entry_km           INTEGER      CHECK (entry_km >= 0),
  complaint          TEXT         NOT NULL,      -- reclamação do cliente
  identified_problems TEXT,
  diagnosis          TEXT,
  notes              TEXT,
  expected_delivery  DATE,
  opened_by          INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,        -- RN05
  opened_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_by          INTEGER      REFERENCES users(id) ON DELETE RESTRICT,
  closed_at          TIMESTAMPTZ,
  closing_notes      TEXT,
  cancel_reason      TEXT,                                                                  -- RN11
  version            INTEGER      NOT NULL DEFAULT 1,                                       -- RN12 (lock otimista)
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (status <> 'cancelada' OR (cancel_reason IS NOT NULL AND closed_by IS NOT NULL)),
  CHECK (status <> 'concluida' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL))
);
ALTER SEQUENCE work_order_number_seq OWNED BY work_orders.number;
CREATE INDEX work_orders_status_idx     ON work_orders (status);
CREATE INDEX work_orders_motorcycle_idx ON work_orders (motorcycle_id);
CREATE INDEX work_orders_customer_idx   ON work_orders (customer_id);
CREATE INDEX work_orders_opened_at_idx  ON work_orders (opened_at DESC);
CREATE INDEX work_orders_opened_by_idx  ON work_orders (opened_by);

CREATE TABLE work_order_items (
  id             SERIAL PRIMARY KEY,
  work_order_id  INTEGER       NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  kind           VARCHAR(10)   NOT NULL CHECK (kind IN ('servico','peca')),
  description    VARCHAR(255)  NOT NULL,
  quantity       NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status         VARCHAR(12)   NOT NULL DEFAULT 'solicitado' CHECK (status IN ('solicitado','realizado')),
  created_by     INTEGER       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  performed_by   INTEGER       REFERENCES users(id) ON DELETE RESTRICT,
  performed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  removed_at     TIMESTAMPTZ,
  removed_by     INTEGER       REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX work_order_items_wo_idx ON work_order_items (work_order_id);

-- Linha do tempo da comanda (4.6). Registros nunca são editados:
-- correções geram um novo registro apontando para o original.
CREATE TABLE work_order_updates (
  id                 SERIAL PRIMARY KEY,
  work_order_id      INTEGER      NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  user_id            INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type               VARCHAR(20)  NOT NULL CHECK (type IN
                       ('abertura','status','diagnostico','servico','peca','observacao','edicao','correcao','finalizacao','cancelamento','remocao')),
  description        TEXT         NOT NULL,
  from_status        VARCHAR(20),
  to_status          VARCHAR(20),
  corrects_update_id INTEGER      REFERENCES work_order_updates(id) ON DELETE RESTRICT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  removed_at         TIMESTAMPTZ,
  removed_by         INTEGER      REFERENCES users(id) ON DELETE RESTRICT,
  removed_reason     TEXT
);
CREATE INDEX work_order_updates_wo_idx   ON work_order_updates (work_order_id, created_at);
CREATE INDEX work_order_updates_user_idx ON work_order_updates (user_id);
CREATE INDEX work_order_updates_recent_idx ON work_order_updates (created_at DESC);

CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER      REFERENCES users(id) ON DELETE RESTRICT,  -- nulo em falhas de login
  action       VARCHAR(50)  NOT NULL,
  entity       VARCHAR(30)  NOT NULL,
  entity_id    INTEGER,
  details      JSONB,
  ip           VARCHAR(45),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx  ON audit_logs (entity, entity_id);

-- Sessões de login (connect-pg-simple)
CREATE TABLE user_sessions (
  sid    VARCHAR      NOT NULL PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX user_sessions_expire_idx ON user_sessions (expire);

INSERT INTO roles (code, name) VALUES
  ('admin', 'Administrador'),
  ('atendente', 'Atendente'),
  ('mecanico', 'Mecânico'),
  ('consulta', 'Consulta');
