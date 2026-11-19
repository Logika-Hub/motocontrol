import { api } from '../scripts/api.js';
import { html, raw, field, modal, toast, fmtDateTime } from '../scripts/ui.js';

export async function render(el, _p, ctx) {
  const [users, roles] = await Promise.all([api.get('/users'), api.get('/users/roles')]);
  const roleOptions = (sel) => roles.map((r) => html`<option value="${r.code}" ${r.code === sel ? 'selected' : ''}>${r.name}</option>`).join('');

  el.innerHTML = html`
    <div class="page-head"><h1>Funcionários</h1><button class="btn btn-primary" data-new>+ Novo funcionário</button></div>
    <section class="card">
      <table class="table">
        <thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th class="hide-sm">Último acesso</th><th>Situação</th><th></th></tr></thead>
        <tbody>${users.map((u) => raw(html`<tr class="${u.active ? '' : 'inactive'}">
          <td>${u.name}${u.id === ctx.user.id ? raw(' <small class="muted">(você)</small>') : ''}</td>
          <td>${u.username}</td><td>${u.role_name}</td>
          <td class="hide-sm">${fmtDateTime(u.last_login_at)}</td>
          <td>${u.active ? raw('<span class="badge status-concluida">Ativo</span>') : raw('<span class="badge status-cancelada">Inativo</span>')}</td>
          <td class="right nowrap">
            <button class="btn btn-sm btn-ghost" data-edit="${u.id}">Editar</button>
            <button class="btn btn-sm btn-ghost" data-reset="${u.id}">Redefinir senha</button>
          </td></tr>`))}</tbody>
      </table>
      <p class="muted small">Contas desativadas perdem o acesso imediatamente, mas o histórico de atividades é preservado.</p>
    </section>`;

  const find = (id) => users.find((u) => u.id === Number(id));
  el.querySelector('[data-new]').addEventListener('click', async () => {
    const ok = await modal({
      title: 'Novo funcionário',
      body: [
        field('Nome', '<input name="name" required>', { required: true }),
        '<div class="row">',
        field('Usuário (login)', '<input name="username" required autocapitalize="none" pattern="[a-z0-9._-]{3,50}">', { required: true, hint: 'Letras minúsculas, números, ponto ou hífen.' }),
        field('Perfil', `<select name="role">${roleOptions('mecanico')}</select>`, { required: true }),
        '</div>',
        field('Senha inicial', '<input name="password" type="text" required minlength="6">', { required: true, hint: 'O funcionário deverá trocá-la no primeiro acesso.' }),
      ].join(''),
      onSubmit: (d) => api.post('/users', d),
    });
    if (ok) { toast('Funcionário cadastrado.'); ctx.refresh(); }
  });

  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const u = find(b.dataset.edit);
    const ok = await modal({
      title: `Editar ${u.name}`,
      body: [
        field('Nome', html`<input name="name" value="${u.name}" required>`, { required: true }),
        field('Perfil', `<select name="role">${roleOptions(u.role)}</select>`),
        html`<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Conta ativa</label>`,
      ].join(''),
      onSubmit: (d) => api.patch(`/users/${u.id}`, d),
    });
    if (ok) { toast('Funcionário atualizado.'); ctx.refresh(); }
  }));

  el.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const u = find(b.dataset.reset);
    const ok = await modal({
      title: `Redefinir senha de ${u.name}`,
      body: field('Nova senha', '<input name="password" type="text" required minlength="6">', { required: true, hint: 'O funcionário deverá trocá-la no próximo acesso.' }),
      submitLabel: 'Redefinir',
      onSubmit: (d) => api.post(`/users/${u.id}/reset-password`, d).then(() => true),
    });
    if (ok) toast('Senha redefinida.');
  }));
}
