import { connect, createSigner } from '@permaweb/aoconnect'

const PROCESS_ID = window.AO_ENV.Process.Id;
const HB_URL = window.location.protocol + '//' + window.location.host;
console.log('Admin interface for process', PROCESS_ID, 'on with ao.env', window.AO_ENV, 'and initial state', window.HYPERENGINE_STATE);
const ao = connect({
  MODE: 'mainnet',
  signer: createSigner(window.arweaveWallet),
  URL: HB_URL,
  SCHEDULER: window.AO_ENV.Process.Tags.Scheduler
})

const PERMISSIONS = ['ACCESS_ADDRESS', 'ACCESS_PUBLIC_KEY', 'SIGN_TRANSACTION']

window.sendActionMessage = async (action, tags, data) => {
  if (!window.arweaveWallet) {
    throw new Error('Arweave wallet not found');
  }
  try {
    await window.arweaveWallet.getActiveAddress();
  } catch (getActiveWalletErr) {
    try {
      await window.arweaveWallet.connect(PERMISSIONS)
    } catch (connectWalletErr) {
      throw new Error('Failed to connect to Arweave wallet: ' + connectWalletErr.message);
    }
  }

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
  console.log('send message result', res);
  if (res.Error) {
    throw new Error(res.Error);
  }
}

window.showMessageResult = (el, msg, ok) => {
  el.className = 'status ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

window.fetchTemplate = async (template_key) => {
  const res = await fetch(`${HB_URL}/${PROCESS_ID}/now/hyperengine_templates/${template_key}`)
  if (!res.ok) throw new Error('Failed to fetch template: ' + res.statusText);
  const template = await res.text();
  console.log('got template', template_key, template.length)
  return template
}

const actionButtons = document.getElementsByClassName('action-button');
const grantSubmitButton = document.getElementById('btn-grant-submit');
const grantStatus = document.getElementById('grant-status');
const grantAddress = document.getElementById('grant-address');
const grantRole = document.getElementById('grant-role');

window.onGrantRoleClicked = async () => {
  const addr = grantAddress.value.trim();
  const role = grantRole.value.trim();
  if (!addr || !role) { window.showMessageResult(grantStatus, 'Address and role required', false); return; }
  try {
    grantSubmitButton.textContent = 'Granting...';
    for (const btn of actionButtons) {
      btn.disabled = 'disabled';
    }
    await window.sendActionMessage('Hyperengine-Grant-Role', { Address: addr, Role: role });
    window.showMessageResult(grantStatus, 'Granted', true);
    window.location.reload();
  } catch (err) {
    console.error(err);
    window.showMessageResult(grantStatus, err.message, false);
    grantSubmitButton.textContent = 'Grant';
    for (const btn of actionButtons) {
      btn.disabled = false;
    }
  }
}

window.onCancelGrantClicked = () => {
  grantAddress.value = '';
  grantRole.value = '';
}

window.onRevokeRoleClicked = (evt) => async (addr, role) => {
  if (!addr || !role) return;
  try {
    evt.target.textContent = 'Revoking...';
    for (const btn of actionButtons) {
      btn.disabled = 'disabled';
    }
    await window.sendActionMessage('Hyperengine-Revoke-Role', { Address: addr, Role: role.trim() });
    window.showMessageResult(grantStatus, 'Revoked', true);
    window.location.reload();
  } catch (err) {
    console.error(err);
    window.showMessageResult(grantStatus, err.message, false);
    grantSubmitButton.textContent = 'Revoke';
    for (const btn of actionButtons) {
      btn.disabled = false;
    }
  }
}

const editorStatus = document.getElementById('editor-status');
const templateKeyInput = document.getElementById('tpl-key');
const templateContentInput = document.getElementById('tpl-content');
const saveTemplateButton = document.getElementById('tpl-save');

window.onEditTemplateClicked = (evt) => async (templateKey) => {
  if (!templateKey) return;
  templateKeyInput.value = templateKey;
  const editButton = document.getElementById('btn-edit-tpl-' + templateKey);
  try {
    editButton.textContent = 'Loading...';
    for (const btn of actionButtons) {
      btn.disabled = 'disabled';
    }
    templateContentInput.value = await window.fetchTemplate(templateKey);
  } catch (err) {
    console.error(err);
    window.showMessageResult(editorStatus, err.message, false);
  } finally {
    editButton.textContent = 'Edit';
    for (const btn of actionButtons) {
      btn.disabled = false;
    }
  }
}

window.onCancelTemplateClicked = () => {
  templateKeyInput.value = '';
  templateContentInput.value = '';
}

window.onDeleteTemplateClicked = (evt) => async (templateKey) => {
  if (!templateKey) return;
  if (!confirm('Delete ' + templateKey + '?')) return;
  try {
    evt.target.textContent = 'Deleting...';
    for (const btn of actionButtons) {
      btn.disabled = 'disabled';
    }
    await window.sendActionMessage('Hyperengine-Remove', { ['Template-Key']: templateKey });
    window.location.reload();
  } catch (err) {
    console.error(err);
    window.showMessageResult(editorStatus, err.message, false);
    evt.target.textContent = 'Delete';
    for (const btn of actionButtons) {
      btn.disabled = false;
    }
  }
}

window.onSaveTemplateClicked = async () => {
  const key = templateKeyInput.value.trim();
  const content = templateContentInput.value;
  if (!key) { window.showMessageResult(editorStatus, 'Key is required', false); return; }
  try {
    saveTemplateButton.textContent = 'Saving...';
    for (const btn of actionButtons) {
      btn.disabled = 'disabled';
    }
    await window.sendActionMessage('Hyperengine-Set', { ['Template-Key']: key }, content);
    window.showMessageResult(editorStatus, 'Saved', true);
    window.location.reload();
  } catch (err) {
    console.error(err);
    window.showMessageResult(editorStatus, err.message, false);
    saveTemplateButton.textContent = 'Save';
    for (const btn of actionButtons) {
      btn.disabled = false;
    }
  }
}

window.onTemplateFileSelected = (evt) => {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    templateKeyInput.value = file.name;
    templateContentInput.value = e.target.result;
    window.showMessageResult(editorStatus, 'File loaded', true);
  }
  reader.onerror = (e) => {
    console.error('File read error', e);
    window.showMessageResult(editorStatus, 'Failed to read file', false);
  }
  reader.readAsText(file);
}

const publishKey = document.getElementById('publish-key');
const publishPath = document.getElementById('publish-path');
const publishButton = document.getElementById('btn-publish-submit');
const publishStatePath = document.getElementById('publish-state-path');
const publishStatus = document.getElementById('publish-status');

window.onPublishTemplateClicked = async () => {
  const template_key = publishKey.value;
  const path = publishPath.value.trim();
  if (!template_key || !path) { window.showMessageResult(publishStatus, 'Template and path are required', false); return; }
  const statePath = publishStatePath.value.trim();
  const tags = { ['Template-Key']: template_key, ['Publish-Path']: path };
  if (statePath) tags['State-Path'] = statePath;
  try {
    publishButton.textContent = 'Publishing...';
    for (const btn of actionButtons) {
      btn.disabled = 'disabled';
    }
    await window.sendActionMessage('Hyperengine-Publish-Template', tags);
    window.showMessageResult(publishStatus, 'Published', true);
    window.location.reload();
  } catch (err) {
    console.error(err);
    window.showMessageResult(publishStatus, err.message, false);
    publishButton.textContent = 'Publish';
    for (const btn of actionButtons) {
      btn.disabled = false;
    }
  }
}

window.onUnpublishTemplateClicked = (evt) => async (path) => {
  if (!path) return;
  if (!confirm('Unpublish ' + path + '?')) return;
  try {
    evt.target.textContent = 'Unpublishing...';
    for (const btn of actionButtons) {
      btn.disabled = 'disabled';
    }
    await window.sendActionMessage('Hyperengine-Unpublish-Template', { ['Publish-Path']: path });
    window.showMessageResult(publishStatus, 'Unpublished', true);
    window.location.reload();
  } catch (err) {
    console.error(err);
    window.showMessageResult(publishStatus, err.message, false);
    evt.target.textContent = 'Unpublish';
    for (const btn of actionButtons) {
      btn.disabled = false;
    }
  }
}

window.onCancelPublishClicked = () => {
  publishKey.value = '';
  publishPath.value = '';
  publishStatePath.value = '';
}
