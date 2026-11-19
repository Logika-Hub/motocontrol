import { api } from '../scripts/api.js';
import { formData, toast, showError } from '../scripts/ui.js';

export function render(el, _params, ctx) {
  el.innerHTML = `
    <div class="page-head"><h1>Alterar senha</h1></div>
    ${ctx.user.mustChangePassword ? '<p class="alert">Por segurança, defina uma nova senha antes de continuar.</p>' : ''}
    <form class="card form narrow" novalidate>
      <label class="field"><span>Senha atual</span><input name="currentPassword" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>Nova senha</span><input name="newPassword" type="password" autocomplete="new-password" minlength="6" required><small>Mínimo de 6 caracteres.</small></label>
      <label class="field"><span>Confirme a nova senha</span><input name="confirm" type="password" autocomplete="new-password" required></label>
      <div class="actions"><button class="btn btn-primary" type="submit">Salvar nova senha</button></div>
    </form>`;
  const form = el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (d.newPassword !== d.confirm) return showError(new Error('A confirmação não confere com a nova senha.'));
    try {
      await api.post('/auth/change-password', { currentPassword: d.currentPassword, newPassword: d.newPassword });
      ctx.user.mustChangePassword = false;
      toast('Senha alterada.');
      ctx.navigate('/');
    } catch (err) { showError(err); }
  });
}
