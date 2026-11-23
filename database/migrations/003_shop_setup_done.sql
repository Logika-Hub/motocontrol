-- Marca se a identidade da oficina já foi configurada (ou dispensada) no primeiro acesso.
-- Instalações que já têm nome ou logo contam como configuradas; as demais verão a tela uma vez.

ALTER TABLE shop_settings ADD COLUMN setup_done_at TIMESTAMPTZ;

UPDATE shop_settings SET setup_done_at = updated_at WHERE name IS NOT NULL OR logo IS NOT NULL;
