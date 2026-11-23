/* Launcher APK, versions 4.0.4 to 7.1.2: the APK adds this file (and launcher-mode.css) to the page; the site itself
   never loads it. 2.1 and 2.3.6 have add-ons of their own (ec-real.js, gb-real-*.js).
   - the phone's real apps and Launcher settings sit in the app drawer (launcher-apk.js); a tap opens them
   - the phone's keys: Back, two quick Backs (Recents), holding Back (Launcher settings), Home (window.launcherKey)
   - the screen turning off locks the simulator (window.gbLockNow)
   - real phone calls on the version's own in-call screen (window.gbRealCall), while it is the default phone app
   - :has() rules work on an older Android WebView too (a small stand-in, below) */
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
      <h3>About</h3>${row('none', '', 'Android System WebView', (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || 'unknown', '')}
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

  // ---- Real calls on the version's own in-call screen -------------------------------------------------------------
  /* The APK reports each call (window.gbRealCall); the call the phone cares about most (ringing, then dialing, then the
     call in progress, then one on hold) is shown on the version's own in-call screen: ICSPhoneCall (4.0.4 to 5.1.1)
     or the Phone module's InCallUI (6.0.1, 7.1.2). A ringing call gets Answer and Decline under it. */
  const calls = new Map();
  const RANK = {ringing: 0, 'select-account': 1, dialing: 1, connecting: 1, active: 2, holding: 3};
  const act = (id, action, value = '') => { try { bridge.callAction(String(id), action, String(value)); } catch (error) { /* gone */ } };
  const shown = id => { try { bridge.callShown?.(id); } catch (error) { /* older APK */ } };
  let shownCall = null, returnTo = null;
  const top = () => [...calls.values()].filter(k => !k.ended).sort((a, b) => (RANK[a.state] ?? 2) - (RANK[b.state] ?? 2))[0] || null;
  const ringBar = (decline, answer, end, call) => `<div class="apk-ring"><span class="apk-ring-label">Incoming call</span><div class="apk-ring-btns"><button type="button" class="apk-ring-decline" data-action="apk-decline" aria-label="Decline"><img src="${end}" alt=""></button><button type="button" class="apk-ring-answer" data-action="apk-answer" aria-label="Answer"><img src="${call}" alt=""></button></div><div class="apk-ring-texts"><span>${decline}</span><span>${answer}</span></div></div>`;
  const sim = () => L.sim;
  const prefix = window.MM ? 'mmph' : 'ngph';
  // The in-call screen's outer element: InCallUI in 6.0.1 (mmph-incall) and 7.1.2 (ngph-call).
  const callRoot = window.MM ? 'mmph-incall' : 'ngph-call';

  // The screens: ICSPhoneCall.render (4.0.4 to 5.1.1) and the Phone module's render (6.0.1, 7.1.2), with the ring bar.
  if (window.ICSPhoneCall?.render) {
    const own = window.ICSPhoneCall.render;
    window.ICSPhoneCall.render = (call, ...rest) => {
      let html = own(call, ...rest);
      if (call?.real && call.state === 'ringing') html = html.replace('class="app-view ', 'class="app-view apk-ringing ').replace(/<\/div>$/, ringBar('Decline', 'Answer', 'assets/phone-ic_end_call.png', 'assets/phone-ic_end_call.png') + '</div>');
      return html;
    };
  }
  const phoneMod = NS?.module?.('phone');
  if (phoneMod?.render) {
    const own = phoneMod.render;
    phoneMod.render = c => {
      let html = own(c);
      const k = c.ui.call;
      if (k?.real && k.state === 'ringing' && html.includes(`class="${callRoot}`)) html = html.replace(`class="${callRoot}`, `class="${callRoot} apk-ringing`).replace(/<\/div>\s*$/, ringBar('Decline', 'Answer', window.MM ? 'assets/gd-fab_ic_end_call.png' : 'assets/gd-quantum_ic_call_end_white_24.png', 'assets/gd-fab_ic_call.png') + '</div>');
      return html;
    };
  }
  // The screen's buttons act on the real call.
  if (phoneMod?.action) {
    const own = phoneMod.action;
    phoneMod.action = (name, el, event, c) => {
      const k = c.ui.call;
      if (k?.real) {
        if (name === 'apk-answer') { act(k.id, 'answer'); return true; }
        if (name === 'apk-decline') { act(k.id, 'reject'); return true; }
        if (name === `${prefix}-hangup`) { act(k.id, k.state === 'ringing' ? 'reject' : 'hangup'); return true; }
        if (name === `${prefix}-ctoggle`) {
          const id = el.dataset.id;
          if (id === 'mute') act(k.id, 'mute', !k.mute);
          else if (id === 'speaker') act(k.id, 'speaker', !k.speaker);
          else if (id === 'hold') act(k.id, k.hold ? 'unhold' : 'hold');
          else return own(name, el, event, c);
          return true;
        }
        if (name === `${prefix}-dtmf`) act(k.id, 'dtmf', el.dataset.k || '');
      }
      return own(name, el, event, c);
    };
  }
  document.addEventListener('click', event => {
    const s = sim(); const k = s?.ui.activeCall;
    if (!k?.real) return;
    const el = event.target.closest?.('[data-action]'); if (!el) return;
    const name = el.dataset.action, id = el.dataset.id;
    const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (name === 'apk-answer') { stop(); act(k.id, 'answer'); }
    else if (name === 'apk-decline') { stop(); act(k.id, 'reject'); }
    else if (name === 'hangup') { stop(); act(k.id, k.state === 'ringing' ? 'reject' : 'hangup'); }
    else if (name === 'incall-toggle' && id !== 'keypad') { stop(); act(k.id, id === 'hold' ? (k.hold ? 'unhold' : 'hold') : id, id === 'hold' ? '' : !k[id]); }
    else if (name === 'incall-digit') act(k.id, 'dtmf', id);
  }, true);

  function showCall() {
    const k = top();
    if (NS) {
      if (!ctx) return;
      if (k) {
        if (!shownCall) returnTo = ctx.ui.view === 'phone' || ctx.ui.view === 'lock' ? 'home' : ctx.ui.view;
        ctx.ui.call = k; shownCall = k;
        if (ctx.ui.view !== 'phone') ctx.open('phone'); else ctx.render();
      }
      if (ctx.el.viewport.querySelector(`.${callRoot}`) && k) shown(k.id);
      return;
    }
    const s = sim(); if (!s) return;
    if (k) {
      if (!shownCall) { returnTo = s.ui.view === 'phone' || s.ui.view === 'lock' ? null : {view: s.ui.view, sub: s.ui.sub}; s.capture(); }
      s.ui.activeCall = k; shownCall = k;
      s.ui.callNumber = k.number; s.ui.view = 'phone'; s.ui.sub = 'calling'; s.ui.overlay = ''; s.ui.sleeping = false;
      s.render();
      if (document.querySelector('#viewport .incall-app, #viewport .lpc-app')) shown(k.id);
    }
  }
  function finish(k) {
    k.ended = Date.now();
    if (NS) {
      if (!ctx) return;
      if (ctx.ui.call === k) ctx.render();
      setTimeout(() => {
        calls.delete(k.id);
        if (ctx.ui.call !== k) return;
        ctx.ui.call = null; shownCall = null;
        if (top()) { showCall(); return; }
        if (ctx.ui.view === 'phone') { if (!returnTo || returnTo === 'home') ctx.home(); else ctx.open(returnTo); }
        returnTo = null;
      }, 1500);
      return;
    }
    const s = sim(); if (!s) return;
    if (s.ui.activeCall === k) {
      const type = k.incoming ? (k.answered ? 'incoming' : 'missed') : 'outgoing';
      try { s.data.callHistory = [...(s.data.callHistory || []), {...window.ICSPhoneCall.finish(k, k.ended), connected: !!k.answered, type}].slice(-50); s.save(); } catch (error) { /* no log */ }
    }
    setTimeout(() => {
      calls.delete(k.id);
      if (s.ui.activeCall !== k) return;
      s.ui.activeCall = null; shownCall = null;
      if (top()) { showCall(); return; }
      if (s.ui.view === 'phone') { s.ui.sub = ''; s.ui.dial = ''; if (returnTo) { s.ui.view = returnTo.view; s.ui.sub = returnTo.sub; } else s.ui.view = 'home'; }
      returnTo = null;
      s.render();
    }, 1200);
  }
  window.gbRealCall = report => {
    report = typeof report === 'string' ? JSON.parse(report) : report;
    if (!report?.id) return;
    let k = calls.get(report.id);
    const gone = report.state === 'disconnected' || report.state === 'disconnecting';
    if (!k) {
      if (gone) return;
      // The fields both screens read: ICSPhoneCall (keypad, digits) and InCallUI (dialpad, dtmf, ended).
      k = {real: true, id: report.id, number: report.number || '', started: Date.now(), connected: Number.MAX_SAFE_INTEGER, mute: false, speaker: false, hold: false, keypad: false, digits: '', dialpad: false, dtmf: '', ended: 0, incoming: !!report.incoming};
      calls.set(report.id, k);
    }
    if (report.number) k.number = report.number;
    if (gone) { if (!k.ended) finish(k); return; }
    k.state = report.state; k.hold = report.state === 'holding'; k.mute = !!report.mute; k.speaker = !!report.speaker;
    if (report.state === 'active' || report.state === 'holding') k.answered = true;
    if (report.connectTime > 0) k.connected = report.connectTime;
    else if (k.answered && k.connected === Number.MAX_SAFE_INTEGER) k.connected = Date.now();
    if (report.state === 'select-account' && report.accounts?.length) { act(k.id, 'account', '0'); }
    showCall();
  };
  const callShown = () => !!shownCall && !shownCall.ended && (ctx ? ctx.ui.view === 'phone' : sim()?.ui.view === 'phone');
  // Calls already up when the page (re)loads.
  window.addEventListener('DOMContentLoaded', () => setTimeout(() => { try { bridge.callNow?.(); } catch (error) { /* none */ } }, 300));
})();
