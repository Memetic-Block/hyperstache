import { message, result, dryrun } from '@permaweb/aoconnect'

const PROCESS = '{{ process_id }}'
const SCHEDULER = '{{ scheduler }}'

async function send(action, tags, data) {
  const t = [{ name: 'Action', value: action }];
  if (tags) Object.entries(tags).forEach(([k, v]) => t.push({ name: k, value: v }));
  const mid = await message({ process: PROCESS, tags: t, data: data || '' });
  const res = await result({ process: PROCESS, message: mid });
  const out = res.Messages && res.Messages[0];
  if (out && out.Tags) {
    const errTag = out.Tags.find(t => t.name === 'Error');
    if (errTag) throw new Error(out.Data || errTag.value);
  }
  return out ? out.Data : '';
}

async function dry(action, tags, data) {
  const t = [{ name: 'Action', value: action }];
  if (tags) Object.entries(tags).forEach(([k, v]) => t.push({ name: k, value: v }));
  const res = await dryrun({ process: PROCESS, tags: t, data: data || '' });
  const out = res.Messages && res.Messages[0];
  return out ? out.Data : '';
}

// --- Tabs ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// --- Templates ---
const listEl = document.getElementById('template-list');
const editorEl = document.getElementById('template-editor');
const keyInput = document.getElementById('tpl-key');
const contentInput = document.getElementById('tpl-content');
const editorStatus = document.getElementById('editor-status');

function showStatus(el, msg, ok) {
  el.className = 'status ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function loadTemplates() {
  listEl.innerHTML = '<div class="list-empty">Loading...</div>';
  try {
    const raw = await dry('Hyperstache-List');
    const keys = raw ? raw.split('\n').filter(Boolean) : [];
    if (!keys.length) { listEl.innerHTML = '<div class="list-empty">No templates</div>'; return; }
    listEl.innerHTML = keys.map(k =>
      '<div class="list-item"><span data-key="' + k + '">' + k + '</span>' +
      '<div class="actions"><button class="secondary" data-edit="' + k + '">Edit</button>' +
      '<button class="danger" data-del="' + k + '">Delete</button></div></div>'
    ).join('');
  } catch (e) { listEl.innerHTML = '<div class="list-empty">Error: ' + e.message + '</div>'; }
}

listEl.addEventListener('click', async (e) => {
  const edit = e.target.dataset.edit || e.target.closest('[data-key]')?.dataset.key;
  const del = e.target.dataset.del;
  if (del) {
    if (!confirm('Delete ' + del + '?')) return;
    try { await send('Hyperstache-Remove', { Key: del }); } catch (err) { alert(err.message); }
    loadTemplates(); loadPreviewKeys();
  } else if (edit) {
    keyInput.value = edit;
    try { contentInput.value = await dry('Hyperstache-Get', { Key: edit }); } catch { contentInput.value = ''; }
    editorEl.classList.remove('hidden'); editorStatus.className = 'hidden';
  }
});
document.getElementById('btn-new').addEventListener('click', () => {
  keyInput.value = ''; contentInput.value = ''; editorEl.classList.remove('hidden');
  editorStatus.className = 'hidden'; keyInput.focus();
});
document.getElementById('btn-cancel').addEventListener('click', () => editorEl.classList.add('hidden'));
document.getElementById('btn-save').addEventListener('click', async () => {
  const k = keyInput.value.trim();
  if (!k) { showStatus(editorStatus, 'Key is required', false); return; }
  try { await send('Hyperstache-Set', { Key: k }, contentInput.value); showStatus(editorStatus, 'Saved', true); loadTemplates(); loadPreviewKeys(); }
  catch (err) { showStatus(editorStatus, err.message, false); }
});
document.getElementById('btn-refresh').addEventListener('click', loadTemplates);

// --- ACL ---
const aclList = document.getElementById('acl-list');
const grantForm = document.getElementById('grant-form');
const grantStatus = document.getElementById('grant-status');

async function loadACL() {
  aclList.innerHTML = '<div class="list-empty">Loading...</div>';
  try {
    const raw = await dry('Hyperstache-Get-Roles');
    if (!raw.trim()) { aclList.innerHTML = '<div class="list-empty">No roles assigned</div>'; return; }
    const lines = raw.split('\n').filter(Boolean);
    aclList.innerHTML = lines.map(line => {
      const [addr, roles] = line.split(':');
      return '<div class="list-item"><span>' + addr + ' — ' + roles + '</span>' +
        '<div class="actions"><button class="danger" data-revoke-addr="' + addr + '" data-revoke-roles="' + roles + '">Revoke</button></div></div>';
    }).join('');
  } catch (e) { aclList.innerHTML = '<div class="list-empty">Error: ' + e.message + '</div>'; }
}

aclList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-revoke-addr]');
  if (!btn) return;
  const addr = btn.dataset.revokeAddr;
  const roles = btn.dataset.revokeRoles.split(',');
  const role = roles.length === 1 ? roles[0] : prompt('Which role to revoke? (' + roles.join(', ') + ')');
  if (!role) return;
  try { await send('Hyperstache-Revoke-Role', { Address: addr, Role: role.trim() }); loadACL(); }
  catch (err) { alert(err.message); }
});
document.getElementById('btn-grant').addEventListener('click', () => { grantForm.classList.remove('hidden'); grantStatus.className = 'hidden'; });
document.getElementById('btn-grant-cancel').addEventListener('click', () => grantForm.classList.add('hidden'));
document.getElementById('btn-grant-submit').addEventListener('click', async () => {
  const addr = document.getElementById('grant-address').value.trim();
  const role = document.getElementById('grant-role').value.trim();
  if (!addr || !role) { showStatus(grantStatus, 'Address and role required', false); return; }
  try { await send('Hyperstache-Grant-Role', { Address: addr, Role: role }); showStatus(grantStatus, 'Granted', true); loadACL(); }
  catch (err) { showStatus(grantStatus, err.message, false); }
});
document.getElementById('btn-acl-refresh').addEventListener('click', loadACL);

// --- Render Preview ---
const previewKey = document.getElementById('preview-key');
const previewData = document.getElementById('preview-data');
const previewOutput = document.getElementById('preview-output');

async function loadPreviewKeys() {
  try {
    const raw = await dry('Hyperstache-List');
    const keys = raw ? raw.split('\n').filter(Boolean) : [];
    previewKey.innerHTML = '<option value="">Select...</option>' + keys.map(k => '<option value="' + k + '">' + k + '</option>').join('');
  } catch {}
}

document.getElementById('btn-render').addEventListener('click', async () => {
  const key = previewKey.value;
  if (!key) return;
  let data;
  try { data = JSON.parse(previewData.value); } catch { previewOutput.textContent = 'Invalid JSON'; return; }
  try {
    const html = await dry('Hyperstache-Render', { Key: key }, JSON.stringify(data));
    previewOutput.innerHTML = html;
  } catch (err) { previewOutput.textContent = 'Error: ' + err.message; }
});

// --- Init ---
loadTemplates();

// Lazy-load ACL & preview keys when their tabs first activate
const obs = new MutationObserver(() => {
  if (document.getElementById('acl').classList.contains('active')) loadACL();
  if (document.getElementById('preview').classList.contains('active')) loadPreviewKeys();
});
document.querySelectorAll('.panel').forEach(p => obs.observe(p, { attributes: true, attributeFilter: ['class'] }));
