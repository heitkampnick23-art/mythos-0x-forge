// Heartbeat embed widget. Served at /v1/embed/heartbeat.js as a self-contained
// script that any site can drop in. Reads `data-soul` from its own <script>
// tag for the Soul slug, then renders a floating chat bubble.

import type { Env } from './types';

export function embedScript(env: Env): string {
  const apiBase = 'https://api.mythos0x.com';
  const siteUrl = env.SITE_URL;

  // The widget runs unobfuscated (so site owners can audit it), shadow-DOM'd
  // for style isolation. Single function, IIFE, no deps.
  return `(function(){
"use strict";
var SCRIPT = document.currentScript || document.querySelector('script[src*="heartbeat.js"]');
if(!SCRIPT) return;
var SOUL = SCRIPT.getAttribute('data-soul');
if(!SOUL){ console.warn('[Heartbeat] missing data-soul on <script>'); return; }
var THEME = SCRIPT.getAttribute('data-theme') || 'dark';
var POSITION = SCRIPT.getAttribute('data-position') || 'right';
var API = '${apiBase}';
var SITE = '${siteUrl}';

// Container with shadow DOM for isolation
var host = document.createElement('div');
host.style.cssText = 'position:fixed;bottom:20px;'+(POSITION==='left'?'left':'right')+':20px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;';
document.body.appendChild(host);
var sd = host.attachShadow({mode:'open'});

var bg = THEME === 'light' ? '#ffffff' : '#0a0608';
var fg = THEME === 'light' ? '#0a0608' : '#ffffff';
var fade = THEME === 'light' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)';
var subtle = THEME === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';

sd.innerHTML = \`
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  .bubble{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#ff5722,#c81d25);box-shadow:0 8px 32px rgba(255,87,34,0.45),0 0 24px rgba(200,29,37,0.35);cursor:pointer;display:flex;align-items:center;justify-content:center;border:none;transition:transform 0.2s;}
  .bubble:hover{transform:scale(1.05)}
  .bubble svg{width:26px;height:26px;color:#fff}
  .panel{position:absolute;bottom:80px;\${POSITION === 'left' ? 'left' : 'right'}:0;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 120px));background:\${bg};border:1px solid \${subtle};border-radius:18px;box-shadow:0 24px 64px rgba(0,0,0,0.45);display:none;flex-direction:column;overflow:hidden}
  .panel.open{display:flex}
  .head{padding:14px 16px;border-bottom:1px solid \${subtle};display:flex;align-items:center;justify-content:space-between;gap:8px}
  .name{color:\${fg};font-size:14px;font-weight:600;letter-spacing:-0.01em}
  .tag{color:\${fade};font-size:11px;margin-top:2px}
  .close{background:none;border:none;color:\${fade};cursor:pointer;font-size:18px;line-height:1;padding:4px 8px;border-radius:6px}
  .close:hover{background:\${subtle}}
  .messages{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
  .msg{max-width:85%;padding:10px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;color:\${fg};white-space:pre-wrap;word-wrap:break-word}
  .msg.user{align-self:flex-end;background:\${subtle}}
  .msg.bot{align-self:flex-start;background:linear-gradient(135deg,rgba(255,87,34,0.10),rgba(200,29,37,0.06));border:1px solid rgba(255,87,34,0.20)}
  .err{align-self:center;font-size:11px;color:#c81d25;background:rgba(200,29,37,0.08);padding:6px 10px;border-radius:8px;text-transform:uppercase;letter-spacing:0.18em}
  .typing{align-self:flex-start;font-size:11px;color:\${fade};text-transform:uppercase;letter-spacing:0.22em;padding:4px 0}
  form{display:flex;align-items:center;gap:6px;padding:10px;border-top:1px solid \${subtle}}
  input{flex:1;background:transparent;border:1px solid \${subtle};border-radius:10px;padding:9px 12px;color:\${fg};font:inherit;font-size:13.5px;outline:none}
  input:focus{border-color:#ff5722}
  button.send{background:linear-gradient(135deg,#ff5722,#c81d25);color:#fff;border:none;border-radius:10px;padding:9px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.2em;cursor:pointer}
  button.send:disabled{opacity:0.4;cursor:not-allowed}
  .credit{padding:6px 14px 10px;font-size:9px;color:\${fade};text-align:center;text-transform:uppercase;letter-spacing:0.28em}
  .credit a{color:inherit;text-decoration:none}
  .credit a:hover{color:#ff5722}
</style>
<button class="bubble" aria-label="Open chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></button>
<div class="panel" role="dialog" aria-label="Heartbeat chat">
  <div class="head">
    <div>
      <div class="name" data-name>Heartbeat</div>
      <div class="tag" data-tag></div>
    </div>
    <button class="close" aria-label="Close">×</button>
  </div>
  <div class="messages" data-msgs></div>
  <form>
    <input type="text" placeholder="Speak…" autocomplete="off">
    <button type="submit" class="send">Send</button>
  </form>
  <div class="credit">Powered by <a href="\${SITE}/agents" target="_blank" rel="noopener">Mythos · 0X · Forge</a></div>
</div>
\`;

var bubble = sd.querySelector('.bubble');
var panel = sd.querySelector('.panel');
var msgs = sd.querySelector('[data-msgs]');
var nameEl = sd.querySelector('[data-name]');
var tagEl = sd.querySelector('[data-tag]');
var input = sd.querySelector('input');
var form = sd.querySelector('form');
var btn = sd.querySelector('button.send');
var session = null;
var sending = false;

function add(role, text){
  var el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}
function err(text){
  var el = document.createElement('div');
  el.className = 'err';
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

bubble.addEventListener('click', function(){
  panel.classList.add('open');
  if(!nameEl.dataset.loaded){ load(); }
  setTimeout(function(){ input.focus(); }, 100);
});
sd.querySelector('.close').addEventListener('click', function(){ panel.classList.remove('open'); });

function load(){
  fetch(API + '/v1/souls/' + encodeURIComponent(SOUL))
    .then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(d){
      var s = d.soul;
      if(!s){ err('Soul not found.'); return; }
      nameEl.textContent = s.name;
      tagEl.textContent = s.tagline || s.voice_label;
      nameEl.dataset.loaded = '1';
      add('bot', s.first_message || 'Hello.');
    })
    .catch(function(){ err('Failed to load Soul.'); });
}

form.addEventListener('submit', function(e){
  e.preventDefault();
  var text = input.value.trim();
  if(!text || sending) return;
  add('user', text);
  input.value = '';
  sending = true;
  btn.disabled = true;
  var typing = document.createElement('div');
  typing.className = 'typing';
  typing.textContent = '· · ·';
  msgs.appendChild(typing);
  msgs.scrollTop = msgs.scrollHeight;

  fetch(API + '/v1/souls/' + encodeURIComponent(SOUL) + '/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: text, session_id: session })
  })
  .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, status: r.status, d: d }; }); })
  .then(function(res){
    typing.remove();
    if(!res.ok){
      if(res.status === 402) err('Daily limit reached. Sign in for more.');
      else err(res.d.error || 'Chat failed.');
      return;
    }
    session = res.d.session_id || session;
    add('bot', res.d.reply);
  })
  .catch(function(){ typing.remove(); err('Network error.'); })
  .finally(function(){ sending = false; btn.disabled = false; input.focus(); });
});
})();`;
}
