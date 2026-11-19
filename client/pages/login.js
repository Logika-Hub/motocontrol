import { api } from '../scripts/api.js';
import { formData } from '../scripts/ui.js';

export function renderLogin(root, onLogin) {
  root.innerHTML = `
    <div class="login-wrap">
      <form class="login card" novalidate>
        <div class="login-brand"><img src="/favicon.svg" alt=""><h1>MotoControl</h1></div>
        <p class="muted">Gerenciamento da oficina</p>
        <label class="field"><span>Usuário</span><input name="username" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
        <p class="login-help"><a href="/ajuda/" target="_blank" rel="noopener">Ajuda e manual de uso</a> · Esqueceu a senha? Peça ao administrador.</p>
      </form>
    </div>`;
  const form = root.querySelector('form');
  const error = form.querySelector('.form-error');
  form.username.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    error.hidden = true;
    try {
      const { user } = await api.post('/auth/login', formData(form));
      onLogin(user);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      btn.disabled = false;
      form.password.select();
    }
  });
}
