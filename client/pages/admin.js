import { api, qs } from '../scripts/api.js';
import { html, raw, toast, showError, fmtDateTime, pager, confirmDialog } from '../scripts/ui.js';
import { loadBrand, logoUrl } from '../scripts/brand.js';

const ACTIONS = {
  login: 'Login', logout: 'Logout', login_falhou: 'Login recusado', criar: 'Criação', editar: 'Edição', excluir: 'Exclusão',
  alterar_status: 'Mudança de status', finalizar: 'Conclusão', cancelar: 'Cancelamento', registrar_atividade: 'Atividade',
  corrigir_registro: 'Correção de registro', remover_registro: 'Remoção de registro', adicionar_item: 'Item adicionado',
  concluir_item: 'Item realizado', remover_item: 'Item removido', redefinir_senha: 'Senha redefinida', alterar_senha: 'Senha alterada',
  alterar_marca: 'Nome/logo alterados', gerar_backup: 'Backup gerado', baixar_backup: 'Backup baixado', transferir_proprietario: 'Troca de proprietário',
};
const ENTITIES = { auth: 'Acesso', users: 'Funcionário', customers: 'Cliente', motorcycles: 'Motocicleta', work_orders: 'Comanda', work_order_updates: 'Histórico', backups: 'Backup', settings: 'Configurações' };
const MAX_SIDE = 512;
const MAX_BYTES = 512 * 1024;

// Redimensiona no navegador (lado maior até 512 px) e reencoda: o servidor recebe sempre um arquivo pequeno
// e limpo (sem metadados). PNG preserva transparência; se ficar grande demais, cai para JPEG.
function prepareLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('Escolha uma imagem PNG, JPG ou WEBP.')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('O arquivo não parece ser uma imagem válida.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        let url = canvas.toDataURL('image/png');
        if (url.length * 0.75 > MAX_BYTES) {
          const flat = document.createElement('canvas');
          flat.width = canvas.width; flat.height = canvas.height;
          const g = flat.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, flat.width, flat.height); g.drawImage(canvas, 0, 0);
          url = flat.toDataURL('image/jpeg', 0.88);
        }
        if (url.length * 0.75 > MAX_BYTES) { reject(new Error('Imagem muito grande mesmo após reduzir. Use um arquivo mais simples.')); return; }
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function render(el, _params, ctx) {
  el.innerHTML = `
    <div class="page-head"><h1>Administração</h1></div>
    <section class="card">
      <div class="card-head"><h2>Identidade da oficina</h2></div>
      <p class="muted small">Nome e logo aparecem no topo das telas, na tela de entrada e na comanda impressa, no lugar de "MotoControl".
        Use PNG, JPG ou WEBP (de preferência com fundo transparente ou branco). A imagem é reduzida automaticamente.</p>
      <form data-brand-form class="grid-2">
        <div>
          <label class="field"><span>Nome da oficina</span><input name="name" maxlength="80" placeholder="Ex.: Moto Peças do Zé"></label>
          <label class="field"><span>Logo</span><input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>
          <div class="brand-actions">
            <button class="btn btn-primary btn-sm" type="submit">Salvar</button>
            <button class="btn btn-ghost btn-sm" type="button" data-remove-logo hidden>Remover logo</button>
          </div>
        </div>
        <div class="brand-preview" data-preview></div>
      </form>
    </section>
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

  const brandForm = el.querySelector('[data-brand-form]');
  const preview = el.querySelector('[data-preview]');
  const removeBtn = el.querySelector('[data-remove-logo]');
  let brand = await loadBrand(true);
  const nameInput = brandForm.querySelector('input[name="name"]');
  let pendingLogo; // undefined = manter; string = nova imagem

  // Só atualiza a prévia; o campo de nome é preenchido apenas ao carregar,
  // para não apagar o que o usuário digitou antes de escolher a imagem.
  function showBrand() {
    removeBtn.hidden = !brand.hasLogo;
    const url = pendingLogo || logoUrl(brand);
    preview.innerHTML = url ? html`<img src="${url}" alt="Logo da oficina">` : '<span class="muted small">Sem logo — será exibido o ícone do MotoControl.</span>';
  }
  async function saveBrand(body, msg) {
    const btns = brandForm.querySelectorAll('button');
    btns.forEach((b) => { b.disabled = true; });
    try {
      brand = await api.put('/admin/branding', body);
      pendingLogo = undefined;
      brandForm.logo.value = '';
      toast(msg);
      if (ctx && ctx.reloadBrand) { await ctx.reloadBrand(); return; }
      showBrand();
    } catch (err) { showError(err); }
    btns.forEach((b) => { b.disabled = false; });
  }
  brandForm.logo.addEventListener('change', async () => {
    const file = brandForm.logo.files[0];
    if (!file) { pendingLogo = undefined; showBrand(); return; }
    try { pendingLogo = await prepareLogo(file); showBrand(); } catch (err) { brandForm.logo.value = ''; showError(err); }
  });
  brandForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = { name: nameInput.value };
    if (pendingLogo) body.logo = pendingLogo;
    saveBrand(body, 'Identidade da oficina salva.');
  });
  removeBtn.addEventListener('click', async () => {
    if (!(await confirmDialog('Remover logo', 'Voltará a aparecer o ícone do MotoControl.', { submitLabel: 'Remover' }))) return;
    saveBrand({ name: nameInput.value, logo: null }, 'Logo removida.');
  });
  nameInput.value = brand.name || '';
  showBrand();

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
