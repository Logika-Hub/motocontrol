-- Chamados (chat) vinculados a uma comanda: o mecânico tira dúvida com o balcão e vice-versa.
-- Mensagens são imutáveis; o encerramento exige um resumo, que vai para a linha do tempo (tipo 'chamado').

ALTER TABLE work_order_updates DROP CONSTRAINT work_order_updates_type_check;
ALTER TABLE work_order_updates ADD CONSTRAINT work_order_updates_type_check CHECK (type IN
  ('abertura','status','diagnostico','servico','peca','observacao','edicao','correcao','finalizacao','cancelamento','remocao','chamado'));

CREATE TABLE work_order_tickets (
  id             SERIAL PRIMARY KEY,
  work_order_id  INTEGER      NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  opened_by      INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- para quem o chamado foi aberto: 'balcao' (atendentes/admin) ou 'oficina' (mecânicos)
  target         VARCHAR(10)  NOT NULL CHECK (target IN ('balcao','oficina')),
  status         VARCHAR(10)  NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','encerrado')),
  closed_by      INTEGER      REFERENCES users(id) ON DELETE RESTRICT,
  closed_at      TIMESTAMPTZ,
  summary        TEXT,
  auto_closed    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (status <> 'encerrado' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL AND summary IS NOT NULL))
);
CREATE INDEX work_order_tickets_wo_idx     ON work_order_tickets (work_order_id);
CREATE INDEX work_order_tickets_status_idx ON work_order_tickets (status, target);

CREATE TABLE work_order_ticket_messages (
  id          SERIAL PRIMARY KEY,
  ticket_id   INTEGER      NOT NULL REFERENCES work_order_tickets(id) ON DELETE RESTRICT,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body        TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX work_order_ticket_messages_ticket_idx ON work_order_ticket_messages (ticket_id, id);
CREATE INDEX work_order_ticket_messages_user_idx   ON work_order_ticket_messages (user_id);

-- Até qual mensagem cada usuário já leu (para o contador de não lidas).
CREATE TABLE work_order_ticket_reads (
  ticket_id             INTEGER     NOT NULL REFERENCES work_order_tickets(id) ON DELETE RESTRICT,
  user_id               INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_read_message_id  INTEGER     NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);
