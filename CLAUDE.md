# MotoControl — contexto para assistentes de IA

Sistema web de gestão de oficinas de motocicletas, centrado na **comanda** (ordem de serviço). Roda em um servidor local na rede da oficina, sem internet. Proprietário. Público e documentação em **português**; código em inglês.

## Leia antes de alterar

- `docs/contexto/01-visao-geral.md` — escopo do MVP (o que **não** fazer: estoque, orçamento, nota fiscal, WhatsApp, multifilial, acesso pela internet).
- `docs/contexto/02-decisoes.md` — decisões e motivos. Não reverta uma decisão sem justificar e registrar uma nova entrada.
- `docs/contexto/03-regras-de-negocio.md` — RN01–RN21 → código → teste.

## Comandos

```bash
npm test            # testes de integração (PostgreSQL real, banco motocontrol_test)
npm run dev         # servidor de desenvolvimento (porta 3000)
npm run seed:demo   # dados de demonstração (demo123 / admin123)
```

Se os testes falharem com `ECONNREFUSED 5432`, o PostgreSQL não está rodando (`service postgresql start`).

## Regras invioláveis

1. **Permissões no back-end:** toda rota em `/api` usa `requirePermission`; a matriz fica só em `server/config/permissions.js`.
2. **Linha do tempo imutável:** nunca editar/apagar `work_order_updates`; correção = novo registro `correcao`; remoção = marcação feita por admin, auditada.
3. **Autor e horário vêm do servidor** (`req.user`, `now()`), nunca do corpo da requisição.
4. **Alterações de comanda** passam por `services/workOrders.js` em transação com `lockOrder` e, quando sobrescrevem dados, exigem `version` (409 se divergir).
5. **Toda alteração relevante grava `audit()`**.
6. **SQL parametrizado** sempre. **HTML no front só com a tag `html\`\``** (escape). CSP proíbe script/estilo inline.
7. **Migrations são imutáveis** depois de publicadas: crie `NNN_*.sql` novo, compatível com dados existentes.
8. **Exclusões são lógicas**; nada com histórico é apagado.

## Onde fica cada coisa

`server/routes` (HTTP e validação) → `server/services` (regras) → PostgreSQL. Front: `client/pages/*.js` (uma tela por arquivo, `render(el, params, ctx)`), roteador em `client/scripts/app.js`. Manual do usuário em `docs/manual/*.md`, servido em `/ajuda`. Instalador `scripts/setup.js`; controle `scripts/control.js`; pacote `scripts/gerar-pacote.js`.

## Ao terminar uma mudança

- `npm test` passando; teste novo para regra nova.
- Atualize o manual se o usuário vê a mudança; `docs/contexto/` se mudou regra ou decisão; `docs/tecnico/` se mudou API, banco ou instalação.
- Nada em Windows foi executado de verdade até agora (ver `docs/contexto/05-situacao-e-proximos-passos.md`): seja explícito sobre o que não foi testado.
