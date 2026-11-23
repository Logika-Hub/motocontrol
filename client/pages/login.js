import { api } from '../scripts/api.js';
import { formData, html, raw } from '../scripts/ui.js';
import { brandMark } from '../scripts/brand.js';

export function renderLogin(root, brand, onLogin) {
  const custom = brand && (brand.name || brand.hasLogo);
  root.innerHTML = html`
    <div class="login-wrap">
      <form class="login card" novalidate>
        <div class="login-brand ${brand && brand.hasLogo ? 'has-logo' : ''}">${raw(brandMark(brand, { withName: !!(brand && brand.name), cls: 'login-logo' }))}</div>
        <p class="muted">${custom ? 'Gerenciamento da oficina · MotoControl' : 'Gerenciamento da oficina'}</p>
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
