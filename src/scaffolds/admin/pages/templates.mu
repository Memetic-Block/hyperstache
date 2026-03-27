<div id="templates">
  <div id="template-list" class="list">
    {{#hyperengine_state.templates}}
    <div class="list-item">
      <span data-key="{{.}}" onclick="onEditTemplateClicked(event)('{{.}}')">{{.}}</span>
      <div class="actions">
        <button id="btn-edit-tpl-{{.}}" class="secondary action-button" onclick="onEditTemplateClicked(event)('{{.}}')">Edit</button>
        <button class="danger action-button" onclick="onDeleteTemplateClicked(event)('{{.}}')">Delete</button>
      </div>
    </div>
    {{/hyperengine_state.templates}}
    {{^hyperengine_state.templates}}
    <div class="list-empty">No templates</div>
    {{/hyperengine_state.templates}}
  </div>
  <div id="template-editor" style="margin-top:1rem;">
    <div id="editor-status"></div>
    <div class="field">
      <label for="tpl-file-input">Template File</label>
      <input type="file" id="tpl-file-input" onchange="onTemplateFileSelected(event)">
    </div>
    <div class="field">
      <label for="tpl-key">Template Key</label>
      <input id="tpl-key" placeholder="e.g. index.html">
    </div>
    <div class="field">
      <label for="tpl-content">Content</label>
      <textarea id="tpl-content" rows="12"></textarea>
    </div>
    <div class="actions">
      <button id="tpl-save" class="action-button" onclick="onSaveTemplateClicked()">Save</button>
      <button id="tpl-cancel" class="secondary action-button" onclick="onCancelTemplateClicked()">Cancel</button>
    </div>
  </div>
</div>
