import { api } from '../scripts/api.js';
import { html, raw, field, modal, toast, confirmDialog, showError, fmtMoney, fmtDateTime } from '../scripts/ui.js';
import { financeTabs } from '../scripts/financeTabs.js';

const dec = (n) => Number(n).toFixed(2).replace('.', ',');
const describe = (r) => (r ? (r.type === 'percentual' ? `${dec(r.value)}% do valor do serviço` : `${fmtMoney(r.value)} por serviço`) : null);

export async function render(el, _p, ctx) {
  el.innerHTML = html`
    <div class="page-head"><h1>Financeiro</h1></div>
    ${raw(financeTabs(ctx))}
    <div class="alert">A regra vale para os <b>próximos fechamentos</b>. Vendas já fechadas guardam a comissão calculada na época e não mudam.
      O percentual incide sobre o valor do serviço <b>já com o desconto</b> rateado; o valor fixo é pago <b>por serviço lançado</b> (limitado ao valor do serviço). Peças não geram comissão.</div>
    <div data-body><p class="loading">Carregando…</p></div>`;
  const body = el.querySelector('[data-body]');

  async function load() {
    const [rules, collab] = await Promise.all([api.get('/finance/rules'), api.get('/finance/collaborators')]);
    const own = new Map(rules.items.map((r) => [r.user_id, r]));
    body.innerHTML = html`
      <section class="card"><div class="card-head"><h2>Regra padrão da oficina</h2><button class="btn btn-primary btn-sm" data-set="">${rules.default ? 'Alterar' : 'Definir'}</button></div>
        <p>${rules.default ? raw(html`<b>${describe(rules.default)}</b> <span class="muted small">— vale para quem não tem regra individual.</span>`) : raw('<span class="muted">Sem regra padrão: quem não tiver regra individual não gera comissão.</span>')}</p></section>
      <section class="card"><h2>Regras por colaborador</h2>
        <table class="table"><thead><tr><th>Colaborador</th><th>Regra aplicada</th><th></th></tr></thead>
        <tbody>${collab.data.map((c) => raw(html`<tr><td><b>${c.name}</b><br><small class="muted">${c.role_name}</small></td>
          <td>${own.has(c.id) ? raw(html`<b>${describe(own.get(c.id))}</b> <span class="tag">individual</span>`) : raw(html`${describe(rules.default) || 'sem comissão'} <span class="tag">padrão</span>`)}</td>
          <td class="right nowrap"><button class="btn btn-sm btn-ghost" data-set="${c.id}">${own.has(c.id) ? 'Alterar' : 'Definir regra própria'}</button>
            ${own.has(c.id) ? raw(html`<button class="btn btn-sm btn-ghost danger" data-end="${own.get(c.id).id}">Voltar ao padrão</button>`) : ''}</td></tr>`))}</tbody></table></section>
      ${rules.history.length ? raw(html`<section class="card"><h2>Histórico de regras</h2><table class="table">
        <thead><tr><th>Quem</th><th>Regra</th><th>Vigência</th></tr></thead>
        <tbody>${rules.history.map((r) => raw(html`<tr><td>${r.user_name || 'Padrão da oficina'}</td><td>${describe(r)}</td>
          <td class="muted small">${fmtDateTime(r.created_at)} (${r.created_by_name}) → ${fmtDateTime(r.ended_at)} (${r.ended_by_name})</td></tr>`))}</tbody></table></section>`) : ''}`;
    body.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
      const userId = b.dataset.set === '' ? null : Number(b.dataset.set);
      const cur = userId === null ? rules.default : own.get(userId);
      const who = userId === null ? 'regra padrão' : collab.data.find((c) => c.id === userId).name;
      modal({
        title: `Comissão — ${who}`,
        body: html`<div class="row">
          ${raw(field('Tipo', html`<select name="type"><option value="percentual" ${!cur || cur.type === 'percentual' ? 'selected' : ''}>Percentual (%)</option><option value="fixo" ${cur && cur.type === 'fixo' ? 'selected' : ''}>Valor fixo por serviço (R$)</option></select>`))}
          ${raw(field('Valor', html`<input name="value" inputmode="decimal" required value="${cur ? dec(cur.value) : ''}">`, { required: true, hint: 'Use vírgula para centavos. Zero = sem comissão.' }))}
        </div>`,
        submitLabel: 'Salvar regra',
        onSubmit: async (d) => {
          await api.put('/finance/rules', { userId, type: d.type, value: d.value });
          toast('Regra salva.');
          await load();
          return true;
        },
      });
    }));
    body.querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Voltar ao padrão', 'Encerrar a regra individual? Os próximos fechamentos usarão a regra padrão.', { submitLabel: 'Encerrar regra' }))) return;
      try { await api.del(`/finance/rules/${b.dataset.end}`); toast('Regra encerrada.'); await load(); } catch (e) { showError(e); }
    }));
  }
  await load();
}
