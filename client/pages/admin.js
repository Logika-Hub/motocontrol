import { api, qs } from '../scripts/api.js';
import { html, raw, toast, showError, fmtDateTime, pager } from '../scripts/ui.js';

const ACTIONS = {
  login: 'Login', logout: 'Logout', login_falhou: 'Login recusado', criar: 'Criação', editar: 'Edição', excluir: 'Exclusão',
  alterar_status: 'Mudança de status', finalizar: 'Conclusão', cancelar: 'Cancelamento', registrar_atividade: 'Atividade',
  corrigir_registro: 'Correção de registro', remover_registro: 'Remoção de registro', adicionar_item: 'Item adicionado',
  concluir_item: 'Item realizado', remover_item: 'Item removido', redefinir_senha: 'Senha redefinida', alterar_senha: 'Senha alterada',
  gerar_backup: 'Backup gerado', baixar_backup: 'Backup baixado', transferir_proprietario: 'Troca de proprietário',
};
const ENTITIES = { auth: 'Acesso', users: 'Funcionário', customers: 'Cliente', motorcycles: 'Motocicleta', work_orders: 'Comanda', work_order_updates: 'Histórico', backups: 'Backup' };

export async function render(el) {
  el.innerHTML = `
    <div class="page-head"><h1>Administração</h1></div>
    <section class="card">
      <div class="card-head"><h2>Backups do banco de dados</h2><button class="btn btn-primary btn-sm" data-backup>Gerar backup agora</button></div>
      <p class="muted small">Backups automáticos são gerados conforme BACKUP_INTERVAL_HOURS. Para restaurar, pare o servidor e use
        <code>npm run restore -- &lt;arquivo&gt;</code>. Guarde cópias periódicas fora deste computador (pendrive ou HD externo).</p>
      <div data-backups></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Auditoria</h2>
        <select data-entity><option value="">Todas as operações</option>${Object.entries(ENTITIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      <div data-audit></div>
    </section>`;

  const backups = el.querySelector('[data-backups]');
  const auditBox = el.querySelector('[data-audit]');
  const state = { page: 1, entity: '' };
  const kb = (n) => `${(n / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;

  async function loadBackups() {
    const list = await api.get('/admin/backups');
    backups.innerHTML = list.length ? html`<table class="table"><thead><tr><th>Arquivo</th><th>Data</th><th>Tamanho</th><th></th></tr></thead>
      <tbody>${list.slice(0, 10).map((b) => raw(html`<tr><td><code>${b.file}</code></td><td>${fmtDateTime(b.created_at)}</td><td>${kb(b.size)}</td>
      <td class="right"><a class="btn btn-sm btn-ghost" href="/api/admin/backups/${encodeURIComponent(b.file)}" download>Baixar</a></td></tr>`))}</tbody></table>
      ${list.length > 10 ? raw(html`<p class="muted small">+ ${list.length - 10} backup(s) mais antigos na pasta de backups.</p>`) : ''}`
      : '<p class="empty">Nenhum backup gerado ainda.</p>';
  }

  async function loadAudit() {
    const d = await api.get(`/admin/audit${qs(state)}`);
    auditBox.innerHTML = d.items.length ? html`<table class="table small"><thead><tr><th>Data</th><th>Funcionário</th><th>Operação</th><th>Registro</th><th class="hide-sm">IP</th></tr></thead>
      <tbody>${d.items.map((a) => raw(html`<tr><td class="nowrap">${fmtDateTime(a.created_at)}</td><td>${a.user_name || '—'}</td>
        <td>${ACTIONS[a.action] || a.action}</td><td>${ENTITIES[a.entity] || a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}</td>
        <td class="hide-sm muted">${a.ip || ''}</td></tr>`))}</tbody></table>${raw(pager(d.page, d.limit, d.total))}`
      : '<p class="empty">Sem registros.</p>';
  }

  el.querySelector('[data-backup]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const b = await api.post('/admin/backups');
      toast(`Backup gerado: ${b.file}`);
      await loadBackups();
    } catch (err) { showError(err); }
    e.target.disabled = false;
  });
  el.querySelector('[data-entity]').addEventListener('change', (e) => { state.entity = e.target.value; state.page = 1; loadAudit(); });
  auditBox.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg) { state.page = Number(pg.dataset.page); loadAudit(); }
  });
  await Promise.all([loadBackups(), loadAudit()]);
}
