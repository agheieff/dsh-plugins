/** The card's styles, in dsh's tokens, square corners; injected once per page. */
const CSS = `
.dsh-sec { display:flex; flex-direction:column; width:100%; margin:6px 0; border-radius:0;
  background:var(--dsw-specific-input-major); box-shadow:var(--dsw-elevation-panel);
  color:var(--dsw-alias-label-primary); overflow:hidden; font-size:14px; line-height:20px; }
.dsh-sec * { box-sizing:border-box; }
.dsh-sec-strip { display:flex; align-items:center; gap:8px; padding:10px 16px; flex-wrap:wrap; }
.dsh-sec-strip[data-tone="ask"] { background:var(--dsw-alias-state-warn-tertiary); color:var(--dsw-alias-state-warn-primary); }
.dsh-sec-strip[data-tone="yes"] { background:var(--dsw-alias-state-success-tertiary); color:var(--dsw-alias-state-success-primary); }
.dsh-sec-strip[data-tone="no"] { background:var(--dsw-alias-state-error-tertiary); color:var(--dsw-alias-state-error-primary); }
.dsh-sec-strip[data-tone="quiet"] { color:var(--dsw-alias-label-tertiary); }
.dsh-sec-dot { width:8px; height:8px; background:currentColor; flex:none; }
.dsh-sec-strong { font-weight:500; }
.dsh-sec-body { display:flex; flex-direction:column; gap:10px; padding:14px 16px 4px; }
.dsh-sec-why { color:var(--dsw-alias-label-secondary); margin:0; white-space:pre-wrap; }
.dsh-sec-link { color:var(--dsw-alias-label-link, inherit); word-break:break-all; }
.dsh-sec-input { width:100%; padding:10px; border:1px solid var(--dsw-alias-border-l2); border-radius:0;
  background:transparent; color:inherit; font:inherit; font-size:16px; }
.dsh-sec-input:focus { outline:none; border-color:var(--dsw-alias-border-l4); }
.dsh-sec-quiet { color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsh-sec-error { color:var(--dsw-alias-state-error-primary); font-size:12px; }
.dsh-sec-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 16px 14px; flex-wrap:wrap; }
.dsh-sec-note { color:var(--dsw-alias-label-tertiary); font-size:12px; flex:1 1 200px; }
.dsh-sec-buttons { display:flex; gap:8px; margin-left:auto; }
.dsh-sec-dock { width:100%; max-width:var(--dsh-chat-content-width); margin:0 auto; display:flex; flex-direction:column;
  gap:8px; max-height:60vh; overflow:auto; }
.dsh-sec-dock:empty { display:none; }
.dsh-sec-dock .dsh-sec { margin:0 0 8px; }
`

export function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('dsh-sec-style')) return
  const tag = document.createElement('style')
  tag.id = 'dsh-sec-style'
  tag.dataset.plugin = '@agheieff/dsh-tool-secret'
  tag.textContent = CSS
  document.head.appendChild(tag)
}
