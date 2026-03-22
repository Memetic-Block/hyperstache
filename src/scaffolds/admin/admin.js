import { connect, createSigner } from '@permaweb/aoconnect'

const PROCESS_ID = window.AO_ENV.Process.Id;
const HB_URL = window.location.protocol + '//' + window.location.host;
console.log('Admin interface for process', PROCESS_ID, 'on with ao.env', window.AO_ENV);
const ao = connect({
  MODE: 'mainnet',
  signer: createSigner(window.arweaveWallet),
  URL: HB_URL,
  SCHEDULER: window.AO_ENV.Process.Tags.Scheduler
})

const STATE_CACHE_TTL = 5_000;
let _stateCache = null;
let _stateCacheTime = 0;
let _stateFlight = null;
function invalidateStateCache() { _stateCache = null; _stateCacheTime = 0; }

async function send(action, tags, data) {
  const t = [{ name: 'Action', value: action }];
  if (tags) Object.entries(tags).forEach(([k, v]) => t.push({ name: k, value: v }));
  console.log('send message', { action, tags, data });
  const mid = await ao.message({
    process: PROCESS_ID,
    tags: t,
    data: data || '',
    signer: createSigner(window.arweaveWallet)
  });
  const res = await ao.result({ process: PROCESS_ID, message: mid });
  console.log('send result', res);
  invalidateStateCache();
  const out = res.Messages && res.Messages[0];
  if (out && out.Tags) {
    const errTag = out.Tags.find(t => t.name === 'Error');
    if (errTag) throw new Error(out.Data || errTag.value);
  }
  return out ? out.Data : '';
}

async function fetchState({ force = false } = {}) {
  if (!force && _stateCache && (Date.now() - _stateCacheTime < STATE_CACHE_TTL)) {
    console.log('using cached state')
    return _stateCache;
  }
  if (_stateFlight) return _stateFlight;
  _stateFlight = fetch(`${HB_URL}/${PROCESS_ID}/now/hyperstache_state/serialize~json@1.0`)
    .then(res => {
      if (!res.ok) throw new Error('Failed to fetch state: ' + res.statusText);
      return res.json();
    })
    .then(state => {
      _stateCache = state;
      _stateCacheTime = Date.now();
      console.log('got state', state)
      return state;
    })
    .finally(() => { _stateFlight = null; });
  return _stateFlight;
}

async function fetchTemplate(template_key) {
  const res = await fetch(`${HB_URL}/${PROCESS_ID}/now/hyperstache_templates/${template_key}`)
  if (!res.ok) throw new Error('Failed to fetch template: ' + res.statusText);
  const template = await res.text();
  console.log('got template', template_key, template.length)
  return template
}

function showStatus(el, msg, ok) {
  el.className = 'status ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function loadTemplates() {
  listEl.innerHTML = '<div class="list-empty">Loading...</div>';
  try {
    const state = await fetchState();
    const keys = state.template_keys ? state.template_keys.split(',').filter(Boolean) : [];
    if (!keys.length) { listEl.innerHTML = '<div class="list-empty">No templates</div>'; return; }
    listEl.innerHTML = keys.map(k =>
      '<div class="list-item"><span data-key="' + k + '">' + k + '</span>' +
      '<div class="actions"><button class="secondary" data-edit="' + k + '">Edit</button>' +
      '<button class="danger" data-del="' + k + '">Delete</button></div></div>'
    ).join('');
  } catch (e) { listEl.innerHTML = '<div class="list-empty">Error: ' + e.message + '</div>'; }
}

async function loadACL() {
  aclList.innerHTML = '<div class="list-empty">Loading...</div>';
  try {
    const state = await fetchState();
    const acl = {}
    for (const k in state) {
      if (k.startsWith('acl_')) {
        const addr = k.slice(4);
        const roles = state[k].split(',').filter(Boolean);
        if (roles.length) acl[addr] = roles;
      }
    }
    const addresses = Object.keys(acl);
    if (!addresses.length) { aclList.innerHTML = '<div class="list-empty">No roles assigned</div>'; return; }
    aclList.innerHTML = addresses.map(addr => {
      const roles = acl[addr].join(', ');
      return '<div class="list-item"><span>' + addr + ' : ' + roles + '</span>' +
        '<div class="actions"><button class="danger" data-revoke-addr="' + addr + '" data-revoke-roles="' + roles + '">Revoke</button></div></div>';
    }).join('');
  } catch (e) { aclList.innerHTML = '<div class="list-empty">Error: ' + e.message + '</div>'; }
}

async function loadPreviewKeys() {
  try {
    const raw = await fetchState('Hyperstache-List');
    const keys = raw ? raw.split('\n').filter(Boolean) : [];
    previewKey.innerHTML = '<option value="">Select...</option>' + keys.map(k => '<option value="' + k + '">' + k + '</option>').join('');
  } catch {}
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

listEl.addEventListener('click', async (e) => {
  const templateName = e.target.dataset.edit || e.target.closest('[data-key]')?.dataset.key;
  const del = e.target.dataset.del;
  if (del) {
    if (!confirm('Delete ' + del + '?')) return;
    const delBtn = e.target;
    try {
      delBtn.disabled = 'disabled';
      delBtn.textContent = 'Deleting...';
      await send('Hyperstache-Remove', { Key: del });
      loadTemplates(); loadPreviewKeys();
    } catch (err) {
      alert(err.message);
    } finally {
      delBtn.disabled = false;
      delBtn.textContent = 'Delete';
    }
  } else if (templateName) {
    keyInput.value = templateName;
    try {
      contentInput.value = await fetchTemplate(templateName);
    } catch (err) { console.error(err); contentInput.value = err.message; }
    editorEl.classList.remove('hidden'); editorStatus.className = 'hidden';
  }
});
document.getElementById('btn-new').addEventListener('click', () => {
  keyInput.value = ''; contentInput.value = ''; editorEl.classList.remove('hidden');
  editorStatus.className = 'hidden'; keyInput.focus();
});
const cancelButton = document.getElementById('btn-cancel')
cancelButton.addEventListener('click', () => editorEl.classList.add('hidden'));
document.getElementById('btn-save').addEventListener('click', async ({ target: saveButton }) => {
  const k = keyInput.value.trim();
  if (!k) { showStatus(editorStatus, 'Key is required', false); return; }
  try {
    saveButton.disabled = 'disabled';
    cancelButton.disabled = 'disabled';
    saveButton.textContent = 'Saving...';
    await send('Hyperstache-Set', { Key: k }, contentInput.value);
    showStatus(editorStatus, 'Saved', true);
    await loadTemplates();
    await loadPreviewKeys();
  } catch (err) {
    showStatus(editorStatus, err.message, false);
  } finally {
    saveButton.disabled = false;
    cancelButton.disabled = false;
    saveButton.textContent = 'Save';
  }
});
// TODO -> debounce this
document.getElementById('btn-refresh').addEventListener('click', () => { invalidateStateCache(); loadTemplates(); });

// --- ACL ---
const aclList = document.getElementById('acl-list');
const grantForm = document.getElementById('grant-form');
const grantStatus = document.getElementById('grant-status');

aclList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-revoke-addr]');
  if (!btn) return;
  const addr = btn.dataset.revokeAddr;
  const roles = btn.dataset.revokeRoles.split(',');
  const role = roles.length === 1 ? roles[0] : prompt('Which role to revoke? (' + roles.join(', ') + ')');
  if (!role) return;
  try {
    btn.disabled = 'disabled';
    btn.textContent = 'Revoking...';
    await send('Hyperstache-Revoke-Role', { Address: addr, Role: role.trim() });
    loadACL();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Revoke';
  }
});
const grantSubmitButton = document.getElementById('btn-grant-submit');
const grantCancelButton = document.getElementById('btn-grant-cancel');
document.getElementById('btn-grant').addEventListener('click', () => { grantForm.classList.remove('hidden'); grantStatus.className = 'hidden'; });
grantCancelButton.addEventListener('click', () => grantForm.classList.add('hidden'));
grantSubmitButton.addEventListener('click', async () => {
  const addr = document.getElementById('grant-address').value.trim();
  const role = document.getElementById('grant-role').value.trim();
  if (!addr || !role) { showStatus(grantStatus, 'Address and role required', false); return; }
  try {
    grantSubmitButton.disabled = 'disabled';
    grantCancelButton.disabled = 'disabled';
    grantSubmitButton.textContent = 'Granting...';
    await send('Hyperstache-Grant-Role', { Address: addr, Role: role });
    showStatus(grantStatus, 'Granted', true);
    loadACL();
  } catch (err) {
    showStatus(grantStatus, err.message, false);
  } finally {
    grantSubmitButton.disabled = false;
    grantCancelButton.disabled = false;
    grantSubmitButton.textContent = 'Grant';
  }
});
document.getElementById('btn-acl-refresh').addEventListener('click', () => { invalidateStateCache(); loadACL(); });

// --- Render Preview ---
const previewKey = document.getElementById('preview-key');
const previewData = document.getElementById('preview-data');
const previewOutput = document.getElementById('preview-output');

const renderButton = document.getElementById('btn-render');
renderButton.addEventListener('click', async () => {
  const key = previewKey.value;
  if (!key) return;
  let data;
  try { data = JSON.parse(previewData.value); } catch { previewOutput.textContent = 'Invalid JSON'; return; }
  try {
    renderButton.disabled = 'disabled';
    renderButton.textContent = 'Rendering...';
    const html = await fetchState('Hyperstache-Render', { Key: key }, JSON.stringify(data));
    previewOutput.innerHTML = html;
  } catch (err) {
    previewOutput.textContent = 'Error: ' + err.message;
  } finally {
    renderButton.disabled = false;
    renderButton.textContent = 'Render';
  }
});

// --- Init ---
loadTemplates();

// Lazy-load ACL & preview keys when their tabs first activate
const obs = new MutationObserver(() => {
  if (document.getElementById('acl').classList.contains('active')) loadACL();
  if (document.getElementById('preview').classList.contains('active')) loadPreviewKeys();
});
document.querySelectorAll('.panel').forEach(p => obs.observe(p, { attributes: true, attributeFilter: ['class'] }));
