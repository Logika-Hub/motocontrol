# Registro de decisões

Cada decisão registra **o que** foi escolhido, **por quê** e **o que se abriu mão**. Antes de mudar uma delas, leia o motivo — várias protegem regras de negócio do briefing.

---

### D01 — Monólito Node.js + Express + PostgreSQL, sem microsserviços
**Contexto:** briefing sugere Node/Express/PostgreSQL e pede simplicidade de manutenção.
**Decisão:** uma única aplicação (`app.js`) servindo API REST e front-end estático.
**Por quê:** uma oficina tem até dezenas de usuários; um processo dá conta com folga e é trivial de instalar e diagnosticar.
**Custo:** escalar para várias filiais exigirá revisão (fora do escopo).

### D02 — Front-end em JavaScript puro, sem framework nem etapa de build
**Decisão:** página única (`client/index.html`) + módulos ES (`client/pages/*.js`), roteamento por `#`.
**Por quê:** instalar = copiar a pasta; nada de `npm run build`, nada que quebre com atualização de framework; qualquer desenvolvedor web entende.
**Custo:** sem componentes reativos — cada tela re-renderiza seu HTML. Aceitável para o porte das telas. Se o front crescer muito, reavaliar (ex.: Preact sem build).

### D03 — Sessões no PostgreSQL, não JWT
**Decisão:** `express-session` + `connect-pg-simple`, cookie `httpOnly`/`sameSite=strict`.
**Por quê:** **desativar um funcionário corta o acesso na hora** (as sessões dele são apagadas) — com JWT seria preciso uma lista de revogação. O usuário também é recarregado do banco a cada requisição, então mudança de perfil vale imediatamente.
**Custo:** uma consulta ao banco por requisição — irrelevante nesta escala.

### D04 — Número da comanda por *sequence* do PostgreSQL (RN01)
**Decisão:** `work_orders.number` com `DEFAULT nextval('work_order_number_seq')`; formato `OS-000001` só na apresentação.
**Por quê:** "maior número + 1" gera duplicados quando dois atendentes abrem comandas ao mesmo tempo. A sequence é atômica.
**Custo:** uma transação que falha "queima" um número (pode haver saltos, ex.: OS-000007 → OS-000009). Aceitável; números nunca se repetem.

### D05 — Controle de concorrência otimista na comanda (RN12)
**Decisão:** coluna `version`; edições de campos, mudança de status, conclusão e cancelamento exigem a versão que o usuário viu. Divergiu → HTTP 409 e a tela recarrega.
**Por quê:** evita que um usuário sobrescreva sem saber o que outro acabou de salvar.
**Detalhe:** registros na linha do tempo e itens **não** exigem versão — são acréscimos, não sobrescrevem nada, e exigir versão geraria conflitos falsos entre mecânicos trabalhando juntos.

### D06 — Linha do tempo imutável; correção cria novo registro
**Decisão:** `work_order_updates` nunca é editado. "Corrigir" cria registro do tipo `correcao` apontando para o original (`corrects_update_id`); "remover" só marca (`removed_at`, motivo) e é exclusivo do administrador, com auditoria.
**Por quê:** briefing 4.6 — "registros anteriores preservados; correções mantêm o histórico; exclusão restrita e auditada". Também dá valor de prova ao histórico em disputas com cliente.

### D07 — Exclusão lógica e bloqueio de exclusão com histórico (RN10)
**Decisão:** clientes/motos têm `deleted_at`; só podem ser excluídos se não tiverem comandas. Funcionários nunca são excluídos, só desativados. Chaves estrangeiras com `ON DELETE RESTRICT`.
**Por quê:** histórico da oficina não pode ficar órfão.

### D08 — Uma comanda em andamento por moto
**Decisão:** abrir comanda para moto que já tem uma ativa é recusado (409).
**Por quê:** evita duplicidade quando dois atendentes recebem a mesma moto. **Não está no briefing** — é suposição; se a oficina precisar (ex.: serviços paralelos de setores diferentes), remover em `services/workOrders.js#create`.

### D09 — Concluir exige serviços realizados
**Decisão:** não conclui se houver item do tipo `servico` com status `solicitado`.
**Por quê:** evita entregar moto com serviço esquecido. Peças pendentes **não** bloqueiam (pode ter sido solicitada e não usada).

### D10 — Comanda concluída/cancelada é imutável; sem reabertura
**Decisão:** estados finais não aceitam alterações (RN09). Não há "reabrir".
**Por quê:** o briefing trata conclusão como registro final. Retorno de cliente → nova comanda citando a anterior. Reabertura (só admin, com justificativa) é candidata à v1.1 se a oficina pedir.

### D11 — Matriz de permissões no back-end, em um único arquivo
**Decisão:** `server/config/permissions.js` define permissões por perfil; toda rota usa `requirePermission`. A interface só esconde botões.
**Suposições sobre o briefing:** atendente pode mudar status, concluir e cancelar; mecânico conclui mas **não** cancela. Ajustar ali se a oficina operar diferente.

### D12 — Backup com `pg_dump` (formato custom) + rotação local
**Decisão:** backup diário automático pelo próprio servidor, mantendo 30; restauração por linha de comando, que faz backup de segurança antes.
**Por quê:** formato custom é compacto e restaurável seletivamente; não depende de agendador externo.
**Risco aceito e comunicado:** backups no mesmo disco. A cópia externa é responsabilidade da oficina (manual e tela de administração avisam).

### D13 — Instalação automatizada e idempotente; pacote offline
**Decisão:** `instalar.bat`/`instalar.sh` → `scripts/setup.js`. Reexecutar preserva `.env`, banco e admin. `npm run pacote` gera pasta com dependências e instaladores do Node.js/PostgreSQL. Instaladores **não** vão para o Git (tamanho e histórico).
**No Windows:** inicialização via **Agendador de Tarefas** (nativo, roda como SYSTEM no boot), não NSSM — evita baixar ferramenta de terceiros.

### D14 — Manual em Markdown, servido dentro do sistema
**Decisão:** `docs/manual/*.md` é a fonte única; o servidor renderiza em `/ajuda` com `marked`.
**Por quê:** o mesmo texto é lido no GitHub e pela oficina, sem internet, e não há duas versões para manter.

### D15 — Licença proprietária
**Decisão:** MIT substituída por "todos os direitos reservados" (`LICENSE`). Dependências de terceiros são MIT/ISC/BSD — compatíveis com uso comercial.
**Pendente:** contrato de licença de uso com cada oficina (prazo, suporte, LGPD) — tarefa jurídica, fora do código.

### D16 — Nome e logo da oficina guardados no banco
**Decisão:** tabela `shop_settings` de linha única (migration 002) com nome e logo (`BYTEA`, até 512 KB, PNG/JPEG/WEBP verificados pelos bytes). Leitura pública em `/marca` (a tela de entrada precisa dela antes do login); alteração só por admin em `PUT /api/admin/branding`, auditada.
**Por quê:** no banco, a logo entra no backup e sobrevive a reinstalação/atualização — arquivo em pasta seria esquecido. O navegador redimensiona antes de enviar, então não há dependência de biblioteca de imagem no servidor.
**SVG recusado:** pode conter script; aceitá-lo exigiria sanitização. O crédito "MotoControl" continua discreto no login e na impressão.

### D17 — Configuração de nome/logo no primeiro acesso do admin
**Decisão:** coluna `shop_settings.setup_done_at` (migration 003). Enquanto for nula, o roteador do front leva quem tem `settings:manage` para `#/configurar-oficina`, logo depois da troca de senha obrigatória. Salvar (`PUT /api/admin/branding`) ou pular (`POST /api/admin/branding/skip`, auditado como `pular_marca`) preenche a coluna.
**Por quê:** sem isso, a maioria das oficinas nunca descobriria a opção em Administração. "Pular" precisa ficar gravado no servidor — guardado só no navegador, a tela voltaria a cada computador/login. Instalações que já tinham nome ou logo foram marcadas como configuradas na própria migration; as demais verão a tela uma vez.
**Limite:** o redirecionamento é só do front (é conveniência, não regra de segurança); a API não bloqueia nada enquanto a configuração está pendente.
