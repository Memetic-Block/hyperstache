local hyperstache = require("hyperstache")

local admin = {}

local _path = "__ADMIN_PATH__"

local _html = [==[
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hyperstache Admin</title>
<script crossorigin type="module">globalThis.process={browser:!0,env:{}}</script>
<script type="importmap">
{
  "imports": {
    "@permaweb/aoconnect": "/-K45UpuInM8T0zvWSQbi-YPuh1LGGfC62DFCaXvRpdM"
  }
}
</script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #e1e4e8; line-height: 1.5; }
  .container { max-width: 960px; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.4rem; margin-bottom: 1rem; color: #58a6ff; }
  .tabs { display: flex; gap: 0; border-bottom: 1px solid #30363d; margin-bottom: 1rem; }
  .tab { padding: 0.5rem 1rem; cursor: pointer; border: 1px solid transparent; border-bottom: none; border-radius: 6px 6px 0 0; background: none; color: #8b949e; font-size: 0.9rem; }
  .tab.active { background: #161b22; color: #e1e4e8; border-color: #30363d; margin-bottom: -1px; }
  .panel { display: none; }
  .panel.active { display: block; }
  button { background: #238636; color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  button:hover { background: #2ea043; }
  button.danger { background: #da3633; }
  button.danger:hover { background: #f85149; }
  button.secondary { background: #30363d; color: #c9d1d9; }
  button.secondary:hover { background: #3d444d; }
  input, textarea, select { background: #0d1117; border: 1px solid #30363d; color: #e1e4e8; padding: 0.4rem 0.6rem; border-radius: 6px; font-family: inherit; font-size: 0.85rem; width: 100%; }
  textarea { font-family: ui-monospace, monospace; resize: vertical; min-height: 200px; }
  label { display: block; font-size: 0.8rem; color: #8b949e; margin-bottom: 0.25rem; }
  .field { margin-bottom: 0.75rem; }
  .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1rem; align-items: center; }
  .list { border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
  .list-item { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; border-bottom: 1px solid #30363d; }
  .list-item:last-child { border-bottom: none; }
  .list-item:hover { background: #161b22; }
  .list-item span { cursor: pointer; flex: 1; }
  .list-empty { padding: 1rem; text-align: center; color: #484f58; }
  .actions { display: flex; gap: 0.4rem; }
  .status { padding: 0.5rem; border-radius: 6px; font-size: 0.85rem; margin-bottom: 0.75rem; }
  .status.ok { background: #0d2818; color: #3fb950; border: 1px solid #238636; }
  .status.err { background: #2d1115; color: #f85149; border: 1px solid #da3633; }
  .preview-frame { background: #fff; border: 1px solid #30363d; border-radius: 6px; min-height: 200px; padding: 1rem; }
  .row { display: flex; gap: 0.75rem; }
  .row > * { flex: 1; }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="container">
  <h1>Hyperstache Admin</h1>
  <div class="tabs">
    <div class="tab active" data-tab="templates">Templates</div>
    <div class="tab" data-tab="acl">Access Control</div>
    <div class="tab" data-tab="preview">Render Preview</div>
  </div>

  <!-- Templates Panel -->
  <div id="templates" class="panel active">
    <div class="toolbar">
      <button id="btn-new">New Template</button>
      <button class="secondary" id="btn-refresh">Refresh</button>
    </div>
    <div id="template-list" class="list"><div class="list-empty">Loading…</div></div>
    <div id="template-editor" class="hidden" style="margin-top:1rem;">
      <div id="editor-status"></div>
      <div class="field">
        <label for="tpl-key">Key</label>
        <input id="tpl-key" placeholder="e.g. index.html">
      </div>
      <div class="field">
        <label for="tpl-content">Content</label>
        <textarea id="tpl-content" rows="12"></textarea>
      </div>
      <div class="actions">
        <button id="btn-save">Save</button>
        <button class="secondary" id="btn-cancel">Cancel</button>
      </div>
    </div>
  </div>

  <!-- ACL Panel -->
  <div id="acl" class="panel">
    <div class="toolbar">
      <button id="btn-grant">Grant Role</button>
      <button class="secondary" id="btn-acl-refresh">Refresh</button>
    </div>
    <div id="acl-list" class="list"><div class="list-empty">Loading…</div></div>
    <div id="grant-form" class="hidden" style="margin-top:1rem;">
      <div id="grant-status"></div>
      <div class="field">
        <label for="grant-address">Address</label>
        <input id="grant-address" placeholder="Wallet address">
      </div>
      <div class="field">
        <label for="grant-role">Role</label>
        <input id="grant-role" placeholder="e.g. admin, Hyperstache-Set">
      </div>
      <div class="actions">
        <button id="btn-grant-submit">Grant</button>
        <button class="secondary" id="btn-grant-cancel">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Render Preview Panel -->
  <div id="preview" class="panel">
    <div class="row">
      <div>
        <div class="field">
          <label for="preview-key">Template</label>
          <select id="preview-key"><option value="">Select…</option></select>
        </div>
        <div class="field">
          <label for="preview-data">Data (JSON)</label>
          <textarea id="preview-data" rows="8">{}</textarea>
        </div>
        <button id="btn-render">Render</button>
      </div>
      <div>
        <label>Output</label>
        <div class="preview-frame" id="preview-output"></div>
      </div>
    </div>
  </div>
</div>

<script type="module">
import { message, result, dryrun } from "@permaweb/aoconnect";

const PROCESS = "__PROCESS_ID__";

async function send(action, tags, data) {
  const t = [{ name: "Action", value: action }];
  if (tags) Object.entries(tags).forEach(([k, v]) => t.push({ name: k, value: v }));
  const mid = await message({ process: PROCESS, tags: t, data: data || "" });
  const res = await result({ process: PROCESS, message: mid });
  const out = res.Messages && res.Messages[0];
  if (out && out.Tags) {
    const errTag = out.Tags.find(t => t.name === "Error");
    if (errTag) throw new Error(out.Data || errTag.value);
  }
  return out ? out.Data : "";
}

async function dry(action, tags, data) {
  const t = [{ name: "Action", value: action }];
  if (tags) Object.entries(tags).forEach(([k, v]) => t.push({ name: k, value: v }));
  const res = await dryrun({ process: PROCESS, tags: t, data: data || "" });
  const out = res.Messages && res.Messages[0];
  return out ? out.Data : "";
}

// --- Tabs ---
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

// --- Templates ---
const listEl = document.getElementById("template-list");
const editorEl = document.getElementById("template-editor");
const keyInput = document.getElementById("tpl-key");
const contentInput = document.getElementById("tpl-content");
const editorStatus = document.getElementById("editor-status");

function showStatus(el, msg, ok) {
  el.className = "status " + (ok ? "ok" : "err");
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function loadTemplates() {
  listEl.innerHTML = '<div class="list-empty">Loading…</div>';
  try {
    const raw = await dry("Hyperstache-List");
    const keys = raw ? raw.split("\n").filter(Boolean) : [];
    if (!keys.length) { listEl.innerHTML = '<div class="list-empty">No templates</div>'; return; }
    listEl.innerHTML = keys.map(k =>
      '<div class="list-item"><span data-key="' + k + '">' + k + '</span>' +
      '<div class="actions"><button class="secondary" data-edit="' + k + '">Edit</button>' +
      '<button class="danger" data-del="' + k + '">Delete</button></div></div>'
    ).join("");
  } catch (e) { listEl.innerHTML = '<div class="list-empty">Error: ' + e.message + '</div>'; }
}

listEl.addEventListener("click", async (e) => {
  const edit = e.target.dataset.edit || e.target.closest("[data-key]")?.dataset.key;
  const del = e.target.dataset.del;
  if (del) {
    if (!confirm("Delete " + del + "?")) return;
    try { await send("Hyperstache-Remove", { Key: del }); } catch (err) { alert(err.message); }
    loadTemplates(); loadPreviewKeys();
  } else if (edit) {
    keyInput.value = edit;
    try { contentInput.value = await dry("Hyperstache-Get", { Key: edit }); } catch { contentInput.value = ""; }
    editorEl.classList.remove("hidden"); editorStatus.className = "hidden";
  }
});
document.getElementById("btn-new").addEventListener("click", () => {
  keyInput.value = ""; contentInput.value = ""; editorEl.classList.remove("hidden");
  editorStatus.className = "hidden"; keyInput.focus();
});
document.getElementById("btn-cancel").addEventListener("click", () => editorEl.classList.add("hidden"));
document.getElementById("btn-save").addEventListener("click", async () => {
  const k = keyInput.value.trim();
  if (!k) { showStatus(editorStatus, "Key is required", false); return; }
  try { await send("Hyperstache-Set", { Key: k }, contentInput.value); showStatus(editorStatus, "Saved", true); loadTemplates(); loadPreviewKeys(); }
  catch (err) { showStatus(editorStatus, err.message, false); }
});
document.getElementById("btn-refresh").addEventListener("click", loadTemplates);

// --- ACL ---
const aclList = document.getElementById("acl-list");
const grantForm = document.getElementById("grant-form");
const grantStatus = document.getElementById("grant-status");

async function loadACL() {
  aclList.innerHTML = '<div class="list-empty">Loading…</div>';
  try {
    const raw = await dry("Hyperstache-Get-Roles");
    if (!raw.trim()) { aclList.innerHTML = '<div class="list-empty">No roles assigned</div>'; return; }
    const lines = raw.split("\n").filter(Boolean);
    aclList.innerHTML = lines.map(line => {
      const [addr, roles] = line.split(":");
      return '<div class="list-item"><span>' + addr + ' — ' + roles + '</span>' +
        '<div class="actions"><button class="danger" data-revoke-addr="' + addr + '" data-revoke-roles="' + roles + '">Revoke</button></div></div>';
    }).join("");
  } catch (e) { aclList.innerHTML = '<div class="list-empty">Error: ' + e.message + '</div>'; }
}

aclList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-revoke-addr]");
  if (!btn) return;
  const addr = btn.dataset.revokeAddr;
  const roles = btn.dataset.revokeRoles.split(",");
  const role = roles.length === 1 ? roles[0] : prompt("Which role to revoke? (" + roles.join(", ") + ")");
  if (!role) return;
  try { await send("Hyperstache-Revoke-Role", { Address: addr, Role: role.trim() }); loadACL(); }
  catch (err) { alert(err.message); }
});
document.getElementById("btn-grant").addEventListener("click", () => { grantForm.classList.remove("hidden"); grantStatus.className = "hidden"; });
document.getElementById("btn-grant-cancel").addEventListener("click", () => grantForm.classList.add("hidden"));
document.getElementById("btn-grant-submit").addEventListener("click", async () => {
  const addr = document.getElementById("grant-address").value.trim();
  const role = document.getElementById("grant-role").value.trim();
  if (!addr || !role) { showStatus(grantStatus, "Address and role required", false); return; }
  try { await send("Hyperstache-Grant-Role", { Address: addr, Role: role }); showStatus(grantStatus, "Granted", true); loadACL(); }
  catch (err) { showStatus(grantStatus, err.message, false); }
});
document.getElementById("btn-acl-refresh").addEventListener("click", loadACL);

// --- Render Preview ---
const previewKey = document.getElementById("preview-key");
const previewData = document.getElementById("preview-data");
const previewOutput = document.getElementById("preview-output");

async function loadPreviewKeys() {
  try {
    const raw = await dry("Hyperstache-List");
    const keys = raw ? raw.split("\n").filter(Boolean) : [];
    previewKey.innerHTML = '<option value="">Select…</option>' + keys.map(k => '<option value="' + k + '">' + k + '</option>').join("");
  } catch {}
}

document.getElementById("btn-render").addEventListener("click", async () => {
  const key = previewKey.value;
  if (!key) return;
  let data;
  try { data = JSON.parse(previewData.value); } catch { previewOutput.textContent = "Invalid JSON"; return; }
  try {
    const html = await dry("Hyperstache-Render", { Key: key }, JSON.stringify(data));
    previewOutput.innerHTML = html;
  } catch (err) { previewOutput.textContent = "Error: " + err.message; }
});

// --- Init ---
loadTemplates();

// Lazy-load ACL & preview keys when their tabs first activate
const obs = new MutationObserver(() => {
  if (document.getElementById("acl").classList.contains("active")) loadACL();
  if (document.getElementById("preview").classList.contains("active")) loadPreviewKeys();
});
document.querySelectorAll(".panel").forEach(p => obs.observe(p, { attributes: true, attributeFilter: ["class"] }));
</script>
</body>
</html>
]==]

function admin.render()
  local html = _html:gsub("__PROCESS_ID__", ao.id)
  hyperstache_admin = html
  return html
end

function admin.publish()
  if not hyperstache_admin then
    admin.render()
  end
  Send({ device = "patch@1.0", [_path] = hyperstache_admin })
end

function admin.handlers()
  admin.render()
  admin.publish()

  Handlers.append("Hyperstache-Admin-Sync-Set",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Set"),
    function(msg)
      if hyperstache.has_permission(msg.From, "Hyperstache-Set") then
        admin.publish()
      end
    end
  )

  Handlers.append("Hyperstache-Admin-Sync-Remove",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Remove"),
    function(msg)
      if hyperstache.has_permission(msg.From, "Hyperstache-Remove") then
        admin.publish()
      end
    end
  )

  Handlers.append("Hyperstache-Admin-Sync-Grant",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Grant-Role"),
    function(msg)
      if hyperstache.has_permission(msg.From, "admin") then
        admin.publish()
      end
    end
  )

  Handlers.append("Hyperstache-Admin-Sync-Revoke",
    Handlers.utils.hasMatchingTag("Action", "Hyperstache-Revoke-Role"),
    function(msg)
      if hyperstache.has_permission(msg.From, "admin") then
        admin.publish()
      end
    end
  )
end

return admin
