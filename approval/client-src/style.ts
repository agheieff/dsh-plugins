/** The card's styles, in the question card's tokens; injected once per page. */
const CSS = `
.dsh-apr { display:flex; flex-direction:column; width:100%; margin:6px 0; border-radius:var(--dsw-radius-xl);
  background:var(--dsw-specific-input-major); box-shadow:var(--dsw-elevation-panel);
  color:var(--dsw-alias-label-primary); overflow:hidden; font-size:14px; line-height:20px; }
.dsh-apr * { box-sizing:border-box; }
.dsh-apr-strip { display:flex; align-items:center; gap:8px; padding:10px 16px; font-size:14px; }
.dsh-apr-strip[data-tone="ask"] { background:var(--dsw-alias-state-warn-tertiary); color:var(--dsw-alias-state-warn-primary); }
.dsh-apr-strip[data-tone="yes"] { background:var(--dsw-alias-state-success-tertiary); color:var(--dsw-alias-state-success-primary); }
.dsh-apr-strip[data-tone="no"] { background:var(--dsw-alias-state-error-tertiary); color:var(--dsw-alias-state-error-primary); }
.dsh-apr-strip[data-tone="quiet"] { color:var(--dsw-alias-label-tertiary); }
.dsh-apr-dot { width:8px; height:8px; border-radius:50%; background:currentColor; flex:none; }
.dsh-apr-action { font-weight:500; }
.dsh-apr-body { display:flex; flex-direction:column; gap:10px; padding:14px 16px 4px; }
.dsh-apr-why { color:var(--dsw-alias-label-secondary); margin:0; }
.dsh-apr-field { display:flex; flex-direction:column; gap:4px; }
.dsh-apr-label { font-size:12px; color:var(--dsw-alias-label-tertiary); }
.dsh-apr-input, .dsh-apr-text { width:100%; padding:8px 10px; border:1px solid var(--dsw-alias-border-l2);
  border-radius:var(--dsw-radius-md); background:transparent; color:inherit; font:inherit; }
.dsh-apr-text { resize:vertical; min-height:72px; font-family:var(--dsh-font-mono, ui-monospace, monospace); font-size:13px; }
.dsh-apr-input:focus, .dsh-apr-text:focus { outline:none; border-color:var(--dsw-alias-border-l4); }
.dsh-apr-pre { margin:0; padding:8px 10px; border-radius:var(--dsw-radius-md); background:var(--dsw-alias-interactive-bg-hover);
  white-space:pre-wrap; word-break:break-word; font-family:var(--dsh-font-mono, ui-monospace, monospace); font-size:13px; }
.dsh-apr-details summary { cursor:pointer; color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsh-apr-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px 14px; flex-wrap:wrap; }
.dsh-apr-note { color:var(--dsw-alias-label-tertiary); font-size:12px; flex:1 1 200px; }
.dsh-apr-buttons { display:flex; gap:8px; margin-left:auto; }
.dsh-apr-dock { width:100%; max-width:var(--dsh-chat-content-width); margin:0 auto; display:flex; flex-direction:column;
  gap:8px; max-height:60vh; overflow:auto; }
.dsh-apr-dock:empty { display:none; }
.dsh-apr-dock .dsh-apr { margin:0 0 8px; }
.dsh-apr-reply { font-weight:500; }
.dsh-apr-reply[data-decision="rejected"] { color:var(--dsw-alias-state-error-primary); }
.dsh-apr-reply[data-decision="approved"], .dsh-apr-reply[data-decision="changed"] { color:var(--dsw-alias-state-success-primary); }
.dsh-apr-reply-id { font-weight:400; color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsh-apr-error { color:var(--dsw-alias-state-error-primary); font-size:12px; }
`

export function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('dsh-apr-style')) return
  const tag = document.createElement('style')
  tag.id = 'dsh-apr-style'
  tag.dataset.plugin = '@agheieff/dsh-tool-approval'
  tag.textContent = CSS
  document.head.appendChild(tag)
}
