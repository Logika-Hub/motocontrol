import { api } from '../scripts/api.js';
import { html, toast, showError } from '../scripts/ui.js';
import { loadBrand, prepareLogo } from '../scripts/brand.js';

// Primeiro acesso do administrador: nome e logo da oficina. Aparece uma única vez;
// salvar ou pular marca a configuração como feita no servidor. Depois, só em Administração.
export function render(el, _params, ctx) {
  el.innerHTML = `
    <div class="page-head"><h1>Bem-vindo ao MotoControl</h1></div>
    <section class="card narrow">
      <p>Antes de começar, informe o nome e a logo da sua oficina. Eles aparecem no topo das telas,
        na tela de entrada e na comanda impressa.</p>
      <form data-setup-form novalidate>
        <label class="field"><span>Nome da oficina</span><input name="name" maxlength="80" placeholder="Ex.: Moto Peças do Zé" autofocus></label>
        <label class="field"><span>Logo (opcional)</span><input type="file" name="logo" accept="image/png,image/jpeg,image/webp">
          <small>PNG, JPG ou WEBP, de preferência com fundo transparente ou branco. A imagem é reduzida automaticamente.</small></label>
        <div class="brand-preview" data-preview><span class="muted small">Sem logo — será exibido o ícone do MotoControl.</span></div>
        <div class="brand-actions">
          <button class="btn btn-primary" type="submit">Salvar e continuar</button>
          <button class="btn btn-ghost" type="button" data-skip>Pular por enquanto</button>
        </div>
        <p class="muted small">Você pode alterar isso depois em Administração → Identidade da oficina.</p>
      </form>
    </section>`;

  const form = el.querySelector('[data-setup-form]');
  const nameInput = form.querySelector('input[name="name"]');
  const fileInput = form.querySelector('input[name="logo"]');
  const preview = el.querySelector('[data-preview]');
  const buttons = form.querySelectorAll('button');
  let pendingLogo;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    pendingLogo = undefined;
    preview.innerHTML = '<span class="muted small">Sem logo — será exibido o ícone do MotoControl.</span>';
    if (!file) return;
    try {
      pendingLogo = await prepareLogo(file);
      preview.innerHTML = html`<img src="${pendingLogo}" alt="Prévia da logo">`;
    } catch (err) { fileInput.value = ''; showError(err); }
  });

  async function finish(action, msg) {
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await action();
      // Atualiza a marca antes de navegar, senão o roteador ainda a veria como não configurada.
      ctx.brand = await loadBrand(true);
      toast(msg);
      ctx.navigate('/');
    } catch (err) {
      showError(err);
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name && !pendingLogo) { showError(new Error('Informe o nome ou escolha uma logo — ou use "Pular por enquanto".')); return; }
    const body = { name };
    if (pendingLogo) body.logo = pendingLogo;
    finish(() => api.put('/admin/branding', body), 'Identidade da oficina salva.');
  });
  el.querySelector('[data-skip]').addEventListener('click', () => {
    finish(() => api.post('/admin/branding/skip'), 'Tudo bem. Você pode configurar depois em Administração.');
  });
}
