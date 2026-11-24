# Arquitetura

## Visão geral

```
 Computadores da oficina (navegador)               Computador servidor
 ┌─────────────────────────────┐   HTTP (LAN)   ┌──────────────────────────────────────────┐
 │ client/index.html            │ ─────────────► │ app.js  (Node.js + Express, porta 3000)   │
 │ client/pages/*.js  (telas)   │ ◄───────────── │   /api/*    API REST (JSON)               │
 │ client/scripts/*.js          │     JSON       │   /ajuda/*  manual (docs/manual → HTML)   │
 └─────────────────────────────┘                │   /*        arquivos estáticos (client/)  │
                                                 │        │                                  │
                                                 │        ▼                                  │
                                                 │   PostgreSQL (dados + sessões)            │
                                                 │   backups/ (pg_dump diário)               │
                                                 └──────────────────────────────────────────┘
```

Uma aplicação, um banco, uma porta. Sem serviços externos — funciona sem internet.

## Estrutura de pastas

```
app.js                        ponto de entrada: monta o Express, aplica migrations, agenda backups
server/
  config/
    env.js                    lê o .env (porta, banco, segredo de sessão, backups)
    db.js                     pool do PostgreSQL + withTransaction()
    permissions.js            matriz perfil → permissões  ← regra de acesso única
  middlewares/
    auth.js                   loadUser (sessão → req.user), requireAuth, requirePermission
    errorHandler.js           converte erros em JSON {error, details}
  routes/                     camada HTTP: valida entrada, chama serviço, responde
    auth.js users.js customers.js motorcycles.js workOrders.js dashboard.js admin.js help.js
  services/                   regras de negócio que vão além de CRUD
    workOrders.js             ciclo de vida da comanda, linha do tempo, concorrência
    audit.js                  grava audit_logs
    backup.js                 pg_dump / pg_restore / agendamento / rotação
  lib/
    errors.js                 AppError, badRequest, notFound, conflict, forbidden
    validation.js             normalização e validação (placa, CPF, datas, paginação)
client/
  index.html                  única página HTML
  scripts/app.js              roteador (#/rota), layout, sessão do usuário
  scripts/api.js              fetch da API, tratamento de erro
  scripts/ui.js               html`` (escape automático), modal, toast, formatação
  scripts/forms.js            formulários reutilizados (cliente, moto, busca de cliente)
  pages/*.js                  uma tela por arquivo; exporta render(el, params, ctx)
  styles/main.css             estilos + modo de impressão da comanda
  styles/ajuda.css            estilos das páginas de ajuda
database/
  migrations/NNN_*.sql        estrutura do banco, versionada
  migrate.js                  aplica migrations pendentes (com advisory lock)
  seeds/seed.js               admin inicial e dados de demonstração
scripts/                      ferramentas de linha de comando
  setup.js                    instalador (chamado por instalar.bat/.sh)
  control.js                  iniciar/parar/status (chamado por iniciar/parar .bat/.sh)
  gerar-pacote.js             monta o pacote de instalação offline
  backup.js restore.js        backup e restauração manuais
tests/                        testes de integração da API (banco real)
docs/                         contexto, manual e documentação técnica
```

## Caminho de uma requisição

Exemplo: mecânico marca um serviço como realizado.

1. **Tela** `client/pages/workOrderDetail.js` → `api.post('/work-orders/12/items/7/done')`.
2. **Sessão** `express-session` lê o cookie `motocontrol.sid` e busca a sessão em `user_sessions`.
3. **`loadUser`** recarrega o usuário do banco (se desativado, a sessão é destruída).
4. **`requireAuth`** + **`requirePermission('work_orders:items')`**.
5. **Rota** `routes/workOrders.js` valida parâmetros e chama `svc.markItemDone`.
6. **Serviço** abre transação → `lockOrder` (`SELECT … FOR UPDATE`, recusa se a comanda estiver finalizada) → atualiza o item → grava registro na linha do tempo → grava auditoria → `COMMIT`.
7. **Resposta** a rota devolve a comanda completa (`getDetail`); a tela re-renderiza.
8. **Erro** em qualquer ponto: `AppError` vira `{error}` com status HTTP adequado; erros do PostgreSQL (`23505`, `23503`...) são traduzidos em `errorHandler.js`.

## Front-end

- **Roteamento:** `location.hash` (`#/comandas/12`). `scripts/app.js` tem a tabela `routes` (padrão → arquivo da página → permissão) e o menu `NAV`.
- **Páginas:** cada `pages/*.js` exporta `render(container, params, ctx)`. `ctx` traz `user`, `can(perm)`, `navigate(path)` e `refresh()`.
- **Segurança de HTML:** sempre montar HTML com a tag `html\`...\`` de `ui.js`, que escapa interpolações. Use `raw()` só para HTML já gerado por `html`.
- **CSP:** `script-src 'self'; style-src 'self'` — sem `<script>` inline, sem `style="..."` e sem `onclick="..."`. Eventos via `addEventListener`.
- **Permissões na tela** usam `ctx.can()` apenas para esconder botões; a garantia é do back-end.

## Segurança

| Aspecto | Como |
|---|---|
| Senhas | bcrypt (custo 10) |
| Sessão | Cookie `httpOnly`, `sameSite=strict`, expira após 12 h sem uso (`rolling`) |
| Autorização | `requirePermission` em todas as rotas de `/api` (exceto login/health) |
| Força bruta | 5 tentativas → bloqueio de 5 min por IP+usuário (em memória) |
| Injeção SQL | Consultas parametrizadas; nomes de colunas dinâmicos só a partir de listas fixas |
| XSS | Escape automático no front + CSP restritiva |
| Cabeçalhos | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` |
| Auditoria | `audit_logs` com usuário, ação, entidade, detalhes e IP |
| Transporte | HTTP na LAN. **HTTPS é obrigatório antes de qualquer exposição à internet** (fora do escopo) |

## Módulo financeiro (D19)

`server/lib/saleCalc.js` (cálculo puro em centavos) → `services/sales.js`, `commissions.js`, `finance.js` (transações, auditoria) → `routes/sales.js`, `routes/finance.js`. Front: `client/pages/{myDashboard,financeAdmin,financeCollaborator,payouts,commissionRules,sales}.js` e `client/scripts/{closing,charts,period,financeReport,financeTabs,saleDetail}.js`. Os gráficos são SVG gerados no cliente (sem biblioteca e sem estilos inline, por causa da CSP).
