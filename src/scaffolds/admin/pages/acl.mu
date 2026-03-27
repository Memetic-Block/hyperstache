<div id="acl">
  <div id="acl-list" class="list">
    {{#hyperengine_acl}}
    {{#roles}}
    <div class="list-item">
      <span class="address">{{address}}</span><span class="arrow">&rarr;</span><span class="acl-role">{{.}}</span>
      <div class="actions">
        <button
          class="action-button danger"
          onclick="onRevokeRoleClicked(event)('{{address}}', '{{.}}')"
        >Revoke</button>
      </div>
    </div>
    {{/roles}}
    {{/hyperengine_acl}}
    {{^hyperengine_acl}}
    <div class="list-empty">No roles assigned</div>
    {{/hyperengine_acl}}
  </div>
  <div id="grant-form">
    <div id="grant-status"></div>
    <div class="field">
      <label for="grant-address">Address</label>
      <input id="grant-address" placeholder="Wallet address">
    </div>
    <div class="field">
      <label for="grant-role">Role</label>
      <input id="grant-role" placeholder="e.g. admin, Hyperengine-Set">
    </div>
    <div class="actions">
      <button id="btn-grant-submit" class="action-button" onclick="onGrantRoleClicked()">Grant</button>
      <button id="btn-grant-cancel" class="secondary action-button" onclick="onCancelGrantClicked()">Cancel</button>
    </div>
  </div>
</div>
