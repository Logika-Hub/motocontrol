# Desenvolvimento

## Preparar o ambiente

Requisitos: Node.js 20+ e PostgreSQL 14+.

```bash
npm install
```
```bash
createdb motocontrol && createdb motocontrol_test
```
Crie o `.env` (em desenvolvimento só `DATABASE_URL` é necessária):
```bash
echo "DATABASE_URL=postgres://USUARIO:SENHA@localhost:5432/motocontrol" > .env
```
```bash
npm run seed:demo
```
```bash
npm run dev
```

Abra `http://localhost:3000`. Usuários de demonstração (senha `demo123`): `joao` (atendente), `carlos` e `paulo` (mecânicos), `ana` (consulta); `admin` / `admin123`.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor reiniciando a cada alteração |
| `npm start` | Servidor normal |
| `npm test` | Testes de integração (banco `motocontrol_test`, recriado a cada execução) |
| `npm run migrate` | Aplica migrations pendentes |
| `npm run seed` / `seed:demo` | Admin inicial / + dados de demonstração |
| `npm run backup` / `restore -- <arquivo>` | Backup e restauração manuais |
| `npm run setup` | Instalador (o mesmo que `instalar.bat`/`.sh` chamam) |
| `npm run pacote` | Gera o pacote de instalação offline em `dist/` |

## Testes

`tests/api.test.js` exercita a API contra um PostgreSQL real, seguindo os critérios de aceitação do briefing. O banco de teste é apagado e recriado no início (`tests/helpers.js#resetDb`), com cinco usuários (`admin`, `joao`, `carlos`, `paulo`, `ana`, senha `senha123`).

Os testes rodam **em sequência e compartilham estado** (a comanda criada num teste é usada no seguinte), como uma história de uso. Para um teste isolado, crie os dados no próprio teste.

Use outro banco com `TEST_DATABASE_URL=postgres://...`.

## Convenções

- **Idioma:** interface, mensagens de erro, documentação e commits em português; código (variáveis, funções, tabelas) em inglês.
- **Rotas** (`server/routes`) cuidam de HTTP e validação de entrada; **serviços** (`server/services`) concentram regras que envolvem várias tabelas ou transações.
- **Toda alteração relevante** grava `audit()`. Toda alteração em comanda grava também na linha do tempo (`addUpdate`).
- **Erros esperados** com `badRequest/notFound/conflict/forbidden` de `server/lib/errors.js` — nunca `res.status(...)` solto no meio de regra de negócio.
- **SQL** sempre parametrizado (`$1`, `$2`). Nunca concatene valor vindo do usuário.
- **Front-end:** HTML só pela tag `html\`\`` (escape automático); sem estilos ou scripts inline (a CSP bloqueia).

## Receitas

### Adicionar uma permissão
1. Acrescente a string (ex.: `work_orders:reopen`) aos perfis em `server/config/permissions.js`. O `admin` (`*`) já tem todas.
2. Use `requirePermission('work_orders:reopen')` na rota.
3. Na tela, esconda o botão com `ctx.can('work_orders:reopen')`.
4. Atualize a tabela de permissões em `docs/manual/01-primeiros-passos.md` e a matriz do `README.md`.

### Adicionar um campo ao cadastro (ex.: e-mail do cliente)
1. Migration `ALTER TABLE customers ADD COLUMN email VARCHAR(150);`.
2. `routes/customers.js#parse` (validação) e os `INSERT`/`UPDATE`.
3. `client/scripts/forms.js#customerModal` e a ficha `pages/customerDetail.js`.
4. Teste em `tests/api.test.js`.

### Adicionar uma tela
1. Crie `client/pages/minhaTela.js` exportando `async function render(el, params, ctx)`.
2. Registre a rota em `client/scripts/app.js` → `routes` (e em `NAV`, se for item de menu).
3. Crie os endpoints em `server/routes/` e monte em `app.js`.

### Adicionar uma página ao manual
Crie `docs/manual/NN-titulo.md` (a primeira linha `# Título` vira o nome no menu). Ela aparece sozinha em `/ajuda`. Imagens em `docs/manual/imagens/`.

## Antes de publicar uma versão

1. `npm test` passando.
2. Testar manualmente o fluxo principal no navegador: abrir comanda → registrar → concluir → imprimir.
3. Atualizar `version` no `package.json`, `docs/contexto/05-situacao-e-proximos-passos.md` e o manual se algo mudou para o usuário.
4. `npm run pacote` e testar o pacote em uma máquina limpa.
