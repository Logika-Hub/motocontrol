-- Identidade da oficina (nome e logo exibidos no lugar de "MotoControl").
-- Linha única (id = 1). A logo fica no banco para entrar nos backups (pg_dump).

CREATE TABLE shop_settings (
  id          SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name        VARCHAR(80),
  logo        BYTEA,
  logo_mime   VARCHAR(20)  CHECK (logo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by  INTEGER      REFERENCES users(id) ON DELETE RESTRICT,
  CHECK ((logo IS NULL) = (logo_mime IS NULL))
);

INSERT INTO shop_settings (id) VALUES (1);
