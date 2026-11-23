/* Launcher APK, versions 4.0.4 to 7.1.2: the APK adds this file (and launcher-mode.css) to the page; the site itself
   never loads it. 2.1 and 2.3.6 have add-ons of their own (ec-real.js, gb-real-*.js).
   - the phone's real apps and Launcher settings sit in the app drawer (launcher-apk.js); a tap opens them
   - the phone's keys: Back, two quick Backs (Recents), holding Back (Launcher settings), Home (window.launcherKey)
   - the screen turning off locks the simulator (window.gbLockNow)
   - real phone calls on a call screen of the launcher's own (window.gbRealCall), while it is the default phone app */
(() => {
  'use strict';
  const L = window.RealLauncher, bridge = window.AndroidLauncher;
  if (!L?.active || !bridge) return;
  const version = (location.pathname.match(/versions\/([\d.]+)\//) || [])[1] || '';
  // 6.0.1 and 7.1.2 run on a module engine (MM, NG); 4.0.4 to 5.1.1 on simulator.js (its hooks in launcher-apk.js).
  const NS = window.MM || window.NG || null;
  let ctx = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // ---- Real apps in the module engines' app drawer -----------------------------------------------------------------
  if (NS) {
    if (NS.appsData) {
      for (const app of L.drawer()) {
        const [pkg, cls] = String(app.id).slice(5).split('/');
        NS.appsData[app.id] = {pkg, cls, label: {en: app.label}, icon: L.iconUrlFor(app.id), color: '#ffffff', version: '', codeSize: 0, permGroups: [], targetSdk: 28, real: true};
      }
    }
    // A module that only takes the engine's context (keys, lock, open).
    NS.register('apk-launcher', {app: false, init(c) { ctx = c; }});
    // The Phone app's call buttons place real calls.
    const phone = NS.module?.('phone');
    if (phone?.action) {
      const own = phone.action;
      phone.action = (name, el, event, c) => {
        const digits = c.ui.phone?.digits || '';
        let number = '';
        if (/-dialcall$/.test(name)) number = digits;
        else if (/-call$/.test(name) || /-dial$/.test(name)) number = el?.dataset?.n || '';
        if (number) { L.call(number); if (c.ui.phone) c.ui.phone.digits = ''; c.render(); return true; }
        return own(name, el, event, c);
      };
    }
  }

  // ---- A tap on a real app opens it; Launcher settings opens the panel below ---------------------------------------
  document.addEventListener('click', event => {
    const el = event.target.closest?.('[data-app^="real:"], [data-id^="real:"]');
    if (!el || el.closest('#apk-panel')) return;
    const id = el.dataset.app?.startsWith('real:') ? el.dataset.app : el.dataset.id;
    event.preventDefault(); event.stopImmediatePropagation();
    if (id === L.SETTINGS_ID) openPanel(); else L.launch(id);
  }, true);

  // ---- The phone's keys -------------------------------------------------------------------------------------------
  const navKey = action => {
    const key = document.querySelector(`#nav-bar [data-action="${action}"]`) || (() => {
      const b = document.createElement('button'); b.hidden = true; b.dataset.action = action;
      document.querySelector('#screen')?.append(b); setTimeout(() => b.remove()); return b;
    })();
    key.click();
  };
  window.launcherKey = name => {
    if (panel) { if (name === 'back' || name === 'menu') closePanel(); else if (name === 'home') closePanel(); return true; }
    if (callShown() && name === 'back') return true;
    if (name === 'menu') { openPanel(); return true; }
    if (ctx) { ctx.key(name === 'recent' ? 'recents' : name); return true; }
    navKey(name);
    return true;
  };
  window.gbxRecents = () => window.launcherKey('recent');

  // ---- Screen off: the lock screen waits when the phone's screen comes back on --------------------------------------
  window.gbLockNow = () => {
    try {
      if (ctx) { ctx.lock(); ctx.wake(); } else L.lockScreen?.();
    } catch (error) { /* keep going */ }
  };
  window.gbRealAppsChanged = () => location.reload();
  window.gbOpenDialer = number => {
    if (ctx) { ctx.open('phone'); const u = ctx.ui.phone; if (u && number) { u.dialpad = true; u.digits = String(number); ctx.render(); } return; }
    const b = document.createElement('button'); b.hidden = true; b.dataset.action = 'open-app'; b.dataset.app = 'phone';
    document.querySelector('#screen')?.append(b); b.click(); b.remove();
  };

  // ---- Launcher settings --------------------------------------------------------------------------------------------
  let panel = null, changed = false;
  function panelHtml() {
    const d = L.defaults(), current = L.version();
    const row = (action, id, title, sub, right) => `<button type="button" class="apk-row" data-apk="${action}" data-id="${esc(id)}"><span class="apk-text"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${right || ''}</button>`;
    const radio = on => `<i class="apk-radio${on ? ' on' : ''}"></i>`, check = on => `<i class="apk-check${on ? ' on' : ''}"></i>`;
    return `<div class="apk-bar"><button type="button" data-apk="close" aria-label="Back">‹</button><span>Launcher settings</span></div><div class="apk-body">
      <h3>Android version</h3>${L.VERSIONS.map(([v, name]) => row('version', v, name, '', radio(v === current))).join('')}
      <h3>Default apps</h3>
      ${row('default', 'home', 'Home app', d.home ? 'Gingerbread Launcher' : 'Not this launcher: tap to choose it', check(d.home))}
      ${row('default', 'phone', 'Phone app', d.phone ? 'Gingerbread Launcher: calls show on its call screen' : 'Not this launcher: calls use the phone’s own screen. Tap to choose it', check(d.phone))}
      <h3>Apps in the drawer</h3>${L.all().map(app => `<button type="button" class="apk-row apk-app" data-apk="app" data-id="${esc(app.id)}"><img src="${esc(L.iconUrl(app))}" alt=""><span class="apk-text"><b>${esc(app.label)}</b></span>${check(L.isShown(app.id))}</button>`).join('')}
    </div>`;
  }
  function openPanel() {
    if (panel) return;
    panel = document.createElement('div'); panel.id = 'apk-panel'; panel.innerHTML = panelHtml();
    panel.addEventListener('click', event => {
      const el = event.target.closest('[data-apk]'); if (!el) return;
      const id = el.dataset.id, what = el.dataset.apk;
      if (what === 'close') closePanel();
      else if (what === 'version') { if (id !== L.version()) L.setVersion(id); }
      else if (what === 'default') L.makeDefault(id);
      else if (what === 'app') { L.toggle(id); changed = true; el.querySelector('.apk-check')?.classList.toggle('on', L.isShown(id)); }
    });
    document.body.append(panel);
  }
  function closePanel() {
    panel?.remove(); panel = null;
    if (changed) location.reload();
  }
  // Back from Android's default-app screens: the panel shows the new choice.
  window.gbOnResume = () => { if (panel) { const top = panel.querySelector('.apk-body')?.scrollTop || 0; panel.innerHTML = panelHtml(); panel.querySelector('.apk-body').scrollTop = top; } };

  // ---- Real calls ---------------------------------------------------------------------------------------------------
  const calls = new Map();
  let callRoot = null, ticker = 0;
  const callShown = () => !!callRoot;
  const NAMES = {dialing: 'Calling…', connecting: 'Calling…', ringing: 'Incoming call', active: '', holding: 'On hold', disconnecting: 'Ending call…', disconnected: 'Call ended', select_account: 'Choose a SIM'};
  function current() {
    const list = [...calls.values()];
    return list.find(c => c.state === 'ringing') || list.find(c => c.state === 'active') || list.find(c => c.state !== 'disconnected') || list[0] || null;
  }
  const act = (id, action, value = '') => { try { bridge.callAction(id, action, String(value)); } catch (error) { /* gone */ } };
  function duration(call) {
    if (!call.connectTime || call.state !== 'active') return '';
    const s = Math.max(0, Math.floor((Date.now() - call.connectTime) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function drawCall() {
    const call = current();
    if (!call) { callRoot?.remove(); callRoot = null; clearInterval(ticker); ticker = 0; return; }
    if (!callRoot) { callRoot = document.createElement('div'); callRoot.id = 'apk-call'; document.body.append(callRoot); callRoot.addEventListener('click', onCallClick); }
    if (!ticker) ticker = setInterval(() => { const t = callRoot?.querySelector('.apk-call-state'), c = current(); if (t && c) t.textContent = c.state === 'active' ? duration(c) : NAMES[c.state] ?? ''; }, 1000);
    const ringing = call.state === 'ringing';
    const btn = (action, label, on, cls = '') => `<button type="button" class="apk-call-btn ${cls}${on ? ' on' : ''}" data-call="${action}"><span>${label}</span></button>`;
    callRoot.className = `apk-call v${version.replace(/\./g, '')}`;
    callRoot.innerHTML = `<div class="apk-call-top"><div class="apk-call-state">${esc(call.state === 'active' ? duration(call) : NAMES[call.state] ?? '')}</div>
      <div class="apk-call-name">${esc(call.number || 'Unknown')}</div><div class="apk-call-avatar"></div></div>
      ${ringing ? `<div class="apk-call-answer">${btn('reject', 'Decline', false, 'red')}${btn('answer', 'Answer', false, 'green')}</div>`
        : call.state === 'disconnected' ? '' : `<div class="apk-call-tools">${btn('mute', 'Mute', call.mute)}${btn('speaker', 'Speaker', call.speaker)}${btn('hold', call.state === 'holding' ? 'Resume' : 'Hold', call.state === 'holding')}</div><div class="apk-call-end">${btn('hangup', 'End call', false, 'red')}</div>`}`;
    try { bridge.callShown?.(call.id); } catch (error) { /* older APK */ }
  }
  function onCallClick(event) {
    const el = event.target.closest('[data-call]'); const call = current(); if (!el || !call) return;
    const what = el.dataset.call;
    if (what === 'mute') act(call.id, 'mute', !call.mute);
    else if (what === 'speaker') act(call.id, 'speaker', !call.speaker);
    else if (what === 'hold') act(call.id, call.state === 'holding' ? 'unhold' : 'hold');
    else act(call.id, what);
  }
  window.gbRealCall = report => {
    const call = typeof report === 'string' ? JSON.parse(report) : report;
    if (!call?.id) return;
    calls.set(call.id, {...(calls.get(call.id) || {}), ...call});
    if (call.state === 'disconnected') setTimeout(() => { if (calls.get(call.id)?.state === 'disconnected') { calls.delete(call.id); drawCall(); } }, 1500);
    drawCall();
  };
  // Calls already up when the page (re)loads.
  try { bridge.callNow?.(); } catch (error) { /* none */ }
})();
