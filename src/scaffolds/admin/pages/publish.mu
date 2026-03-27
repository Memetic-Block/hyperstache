<div id="publish">
  <div id="published-list" class="list">
    {{#hyperengine_state.published}}
    <div class="list-item">
      <a href="../{{path}}" target="_blank">/{{path}} &rarr; {{template_name}}</a>
      <div class="actions">
        <button
          class="danger action-button"
          data-unpublish="{{path}}"
          onclick="onUnpublishTemplateClicked(event)('{{path}}')"
        >Unpublish</button>
      </div>
    </div>
    {{/hyperengine_state.published}}
    {{^hyperengine_state.published}}
    <div class="list-empty">Nothing published</div>
    {{/hyperengine_state.published}}
  </div>
  <div id="publish-form" style="margin-top:1rem;">
    <div id="publish-status"></div>
    <div class="field">
      <label for="publish-key">Template</label>
      <select id="publish-key">
        <option value="">Select...</option>
        {{#hyperengine_state.templates}}
        <option value="{{.}}">{{.}}</option>
        {{/hyperengine_state.templates}}
      </select>
    </div>
    <div class="field">
      <label for="publish-path">Path (relative to UI root {{ui_root}}/)</label>
      <input id="publish-path" placeholder="e.g. home or me/profile">
    </div>
    <div class="field">
      <label for="publish-state-path">State Path <span class="hint">(Lua global, e.g. ao.env.Process)</span></label>
      <input id="publish-state-path" placeholder="e.g. Profile">
    </div>
    <div class="actions">
      <button id="btn-publish-submit" class="action-button" onclick="onPublishTemplateClicked()">Publish</button>
      <button id="btn-publish-cancel" class="secondary action-button" onclick="onCancelPublishClicked()">Cancel</button>
    </div>
  </div>
</div>
