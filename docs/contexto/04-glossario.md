# Glossário

Termos usados na interface, no código e na documentação. Entre parênteses, o nome no código.

| Termo | Significado |
|---|---|
| **Comanda / Ordem de serviço / OS** (`work_order`) | Registro de uma entrada da moto na oficina. Identificada por `OS-000001` (`number` no banco, formatado com `formatNumber`) |
| **Status / Situação** (`status`) | `aberta`, `em_diagnostico`, `aguardando_pecas`, `em_execucao` (ativos) e `concluida`, `cancelada` (finais) |
| **Comanda em andamento** | Comanda em qualquer status ativo |
| **Reclamação do cliente** (`complaint`) | O problema relatado pelo cliente na entrada. Obrigatória |
| **Problemas identificados** (`identified_problems`) | O que o mecânico encontrou além da reclamação |
| **Diagnóstico** (`diagnosis`) | Conclusão técnica sobre a causa |
| **Item** (`work_order_item`) | Serviço (`servico`) ou peça (`peca`) da comanda. Situação `solicitado` → `realizado` |
| **Linha do tempo / Histórico de atividades** (`work_order_updates`) | Registros imutáveis da comanda, cada um com autor, horário e tipo |
| **Tipo de registro** (`type`) | Automáticos: `abertura`, `status`, `edicao`, `finalizacao`, `cancelamento`, `remocao`, e `servico`/`peca` gerados por itens. Manuais: `observacao`, `diagnostico`, `servico`, `correcao` |
| **Correção** (`correcao`) | Novo registro que corrige outro, apontando para ele (`corrects_update_id`). O original fica marcado como "corrigido" |
| **Remoção de registro** (`removed_at`) | Marcação feita só pelo administrador, com motivo. O registro continua no banco |
| **Versão** (`version`) | Contador da comanda usado para detectar edições simultâneas (HTTP 409) |
| **Histórico de manutenção** | Todas as comandas de uma moto (`GET /api/motorcycles/:id` → `history`) |
| **Perfil** (`role`) | `admin`, `atendente`, `mecanico`, `consulta` |
| **Permissão** | Ação autorizada para um perfil, ex.: `work_orders:cancel`. Ver `server/config/permissions.js` |
| **Auditoria** (`audit_logs`) | Registro de operações relevantes do sistema inteiro (login, cadastros, exclusões, backups...) |
| **Exclusão lógica** (`deleted_at`) | Registro marcado como excluído, não apagado fisicamente |
| **Servidor** | O computador da oficina onde o MotoControl e o PostgreSQL estão instalados |
| **Pacote** | Pasta gerada por `npm run pacote` para instalação offline |
| **Migration** | Arquivo SQL numerado em `database/migrations/` que altera a estrutura do banco; aplicado automaticamente na inicialização |
