/* Launcher APK, shared by every version it runs: the phone's real apps, which of them the app
   drawer shows (Launcher settings > Apps in the drawer; Files and Claude by default), the Android version and the
   default Home / phone app. The choices live in localStorage under one key, so switching versions keeps them.
   In an ordinary browser window.AndroidLauncher is missing and RealLauncher.active is false. */
(() => {
  'use strict';
  const bridge = window.AndroidLauncher || null;
  const KEY = 'gingerbread-launcher-v1';
  const VERSIONS = [['2.1', 'Android 2.1 Eclair'], ['2.3.6', 'Android 2.3.6 Gingerbread'], ['4.0.4', 'Android 4.0.4 Ice Cream Sandwich'],
    ['4.3', 'Android 4.3 Jelly Bean'], ['4.4.4', 'Android 4.4.4 KitKat'], ['5.1.1', 'Android 5.1.1 Lollipop'], ['6.0.1', 'Android 6.0.1 Marshmallow'],
    ['7.1.2', 'Android 7.1.2 Nougat']];
  // The site root (where this file is), so icon addresses work from any page depth.
  const ROOT = (() => { try { return new URL('.', document.currentScript?.src || location.href).href; } catch (error) { return '/'; } })();
  // This launcher's own icon, for the Launcher settings entry of the app drawer.
  const SELF = 'net.gingerbread.launcher/net.gingerbread.launcher.MainActivity';
  const SETTINGS_ID = 'real:@launcher-settings';
  // Files apps of common phones, then Claude: shown in the drawer until the user picks the apps.
  const FILES = ['com.google.android.apps.nbu.files', 'com.google.android.documentsui', 'com.android.documentsui', 'com.sec.android.app.myfiles',
    'com.mi.android.globalFileexplorer', 'com.coloros.filemanager', 'com.oneplus.filemanager', 'com.huawei.filemanager'];
  const CLAUDE = ['com.anthropic.claude'];

  let all = [];
  if (bridge) {
    try { all = (JSON.parse(bridge.apps()) || []).filter(app => app && app.id); } catch (error) { all = []; }
    all.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    document.documentElement.classList.add('apk-launcher');
    // A home screen opens straight away: no boot animation in any version.
    const page = location.pathname.match(/versions\/([\d.]+)\//);
    if (page) { try { sessionStorage.setItem(`android-sim-booted-${page[1]}`, '1'); } catch (error) { /* storage blocked */ } }
    /* An icon the page could not load (/real-icon/ unanswered) is asked for again as a data: address. */
    const fixed = new Set();
    document.addEventListener('error', event => {
      const img = event.target;
      if (!img || img.tagName !== 'IMG') return;
      const match = String(img.currentSrc || img.src || '').match(/real-icon\/([^?#]+)\.png/);
      if (!match || fixed.has(img)) return;
      fixed.add(img);
      try { const data = bridge.iconData?.(decodeURIComponent(match[1]).replace('__', '/')); if (data) img.src = data; } catch (error) { /* keep it */ }
    }, true);
  }
  const pkg = id => String(id).slice(5).split('/')[0];
  const find = packages => { for (const name of packages) { const app = all.find(item => pkg(item.id) === name); if (app) return app.id; } return null; };
  const starters = () => [find(FILES), find(CLAUDE)].filter(Boolean);

  function prefs() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (error) { saved = {}; }
    return saved;
  }
  function store(next) { try { localStorage.setItem(KEY, JSON.stringify({...prefs(), ...next})); } catch (error) { /* storage blocked */ } }

  // The ids of the real apps the drawer shows (only apps still installed).
  function shownIds() {
    const chosen = prefs().shown;
    const ids = Array.isArray(chosen) ? chosen : starters();
    return ids.filter(id => all.some(app => app.id === id));
  }


  /* An older Android WebView (before Chrome 105) drops every CSS rule with :has(), and the simulators use it for app
     backgrounds, full-screen views and bars. Here each such rule is rewritten with a class that is kept on the
     elements :has() would match (A:has(B) -> A.apk-has-N, tested with querySelector), so the pages look the same. */
  function hasStandIn() {
    let supported = false;
    try { supported = CSS.supports('selector(:has(*))'); } catch (error) { supported = false; }
    if (supported || !bridge) return;
    const tests = [];
    // querySelectorAll('A:has(B), …') from the pages' scripts: A's matches that contain a B.
    const qsa = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function (selector) {
      if (!String(selector).includes(':has(')) return qsa.call(this, selector);
      const found = new Set();
      for (const part of split(String(selector))) {
        const m = part.match(/^(.*?):has\((.*)\)$/);
        if (!m) { try { qsa.call(this, part).forEach(n => found.add(n)); } catch (error) { /* skip */ } continue; }
        for (const n of qsa.call(this, m[1] || '*')) { try { if (n.querySelector(m[2].trim().startsWith('>') ? `:scope${m[2]}` : m[2])) found.add(n); } catch (error) { /* skip */ } }
      }
      return [...found];
    };
    // The top-level rules of a stylesheet's text (@media blocks keep their rules inside), with their selectors.
    function rewrite(text) {
      let out = '', i = 0;
      const block = from => { let depth = 0, j = from; for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}') { depth--; if (!depth) break; } } return j; };
      while (i < text.length) {
        const open = text.indexOf('{', i); if (open < 0) break;
        const prelude = text.slice(i, open).trim(), end = block(open);
        if (prelude.startsWith('@media') || prelude.startsWith('@supports')) { const inner = rewrite(text.slice(open + 1, end)); if (inner) out += `${prelude}{${inner}}`; }
        else if (!prelude.startsWith('@') && prelude.includes(':has(')) {
          const sels = split(prelude).map(convert).filter(Boolean);
          if (sels.length) out += `${sels.join(',')}${text.slice(open, end + 1)}`;
        }
        i = end + 1;
      }
      return out;
    }
    function split(list) { const parts = []; let depth = 0, cur = ''; for (const ch of list) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; } parts.push(cur); return parts.map(p => p.trim()).filter(Boolean); }
    function convert(sel) {
      if (!sel.includes(':has(')) return '';
      let guard = 0;
      while (sel.includes(':has(') && guard++ < 4) {
        const at = sel.indexOf(':has(');
        let depth = 1, j = at + 5; for (; j < sel.length && depth; j++) { if (sel[j] === '(') depth++; else if (sel[j] === ')') depth--; }
        const arg = sel.slice(at + 5, j - 1).trim();
        if (arg.includes(':has(') || /^[+~]/.test(arg)) return '';
        // The compound selector :has() is attached to: back to the last combinator outside brackets.
        let k = at - 1, d = 0; for (; k >= 0; k--) { const ch = sel[k]; if (ch === ')' || ch === ']') d++; else if (ch === '(' || ch === '[') d--; else if (!d && /[\s>+~]/.test(ch)) break; }
        const anchor = sel.slice(k + 1, at).replace(/:has\(.*$/, '') || '*';
        const cls = `apk-has-${tests.length}`;
        tests.push({anchor: anchor.replace(/\.apk-has-\d+/g, '') || '*', arg: arg.startsWith('>') ? `:scope${arg}` : `:scope ${arg}`, cls});
        sel = sel.slice(0, at) + '.' + cls + sel.slice(j);
      }
      return sel;
    }
    function apply() {
      for (const test of tests) {
        let nodes; try { nodes = document.querySelectorAll(test.anchor); } catch (error) { continue; }
        for (const node of nodes) { let on = false; try { on = !!node.querySelector(test.arg); } catch (error) { on = false; } if (node.classList.contains(test.cls) !== on) node.classList.toggle(test.cls, on); }
      }
    }
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
    Promise.all(links.map(link => fetch(link.href).then(r => r.text()).then(text => {
      const css = rewrite(text.replace(/\/\*[\s\S]*?\*\//g, ''));
      if (!css) return;
      const style = document.createElement('style'); style.textContent = css; link.after(style);
    }).catch(() => {}))).then(() => {
      let frame = 0;
      const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; apply(); }); };
      apply();
      new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open']});
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hasStandIn); else hasStandIn();


  /* The site's own keyboard in every version instead of the phone's: 2.1, 6.0.1 and 7.1.2 bring a full keyboard of their
     own; 4.4.4 and 5.1.1 draw theirs with KKIme / LPIme; 4.0.4 and 4.3 borrow the 4.4.4 Holo keyboard; 2.3.6 gets
     Gingerbread's keyboard keys (PasswordEntryKeyboardView art). Every text field is marked inputmode="none" so
     Android's own keyboard stays down. */
  function siteKeyboard() {
    const version = (location.pathname.match(/versions\/([\d.]+)\//) || [])[1] || '';
    const OWN = ['2.1', '6.0.1', '7.1.2'];
    const eligible = el => !!el && el.closest?.('#screen') && !el.closest('#apk-panel') && !el.disabled && !el.readOnly &&
      (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|email|url|password|tel|number)$/.test(el.type || 'text')));
    const mark = root => { for (const el of root.querySelectorAll?.('input, textarea') || []) if (eligible(el) && !el.hasAttribute('inputmode')) el.setAttribute('inputmode', 'none'); };
    mark(document);
    new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) { if (eligible(n) && !n.hasAttribute('inputmode')) n.setAttribute('inputmode', 'none'); mark(n); } })
      .observe(document.documentElement, {subtree: true, childList: true});
    if (OWN.includes(version)) return;
    const style = document.createElement('style');
    style.textContent = '#apk-kb{position:absolute;left:0;right:0;bottom:0;z-index:60;touch-action:none}' +
      '#apk-kb .apk-kb-gb{background:linear-gradient(#4a4a4a,#1c1c1c 12%,#000);padding:calc(3 * var(--dp)) 0 calc(2 * var(--dp))}' +
      '#apk-kb .apk-kb-gb button{height:calc(46 * var(--dp))}';
    document.head.append(style);

    // 4.0.4 and 4.3 borrow the KitKat keyboard (its script, stylesheet and key art from ../4.4.4/).
    const BORROW = ['4.0.4', '4.3'].includes(version);
    if (BORROW) {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '../4.4.4/kk-ime.css'; document.head.append(css);
      const js = document.createElement('script'); js.src = '../4.4.4/kk-ime.js'; document.head.append(js);
    }
    const lang = () => (window.i18n?.language || document.documentElement.lang || 'en').slice(0, 2);
    const state = {field: null, shift: false, symbols: false, more: false};
    let root = null, saved = null;

    function gingerbread(number) {
      const b = (k, label, cls = '') => `<button type="button" class="${cls}" data-apk-key="${k}" aria-label="${k}">${label}</button>`;
      const icon = (k, file, cls = '') => `<button type="button" class="${cls}" data-apk-key="${k}" aria-label="${k}"><img src="assets/gb-${file}.png" alt=""></button>`;
      if (number) return `<div class="gbkb gbkb-numeric apk-kb-gb">${'123456789'.split('').map(k => icon(k, `sym_keyboard_num${k}`)).join('')}${icon('next', 'sym_keyboard_ok')}${icon('0', 'sym_keyboard_num0_no_plus')}${icon('delete', 'sym_keyboard_delete')}</div>`;
      const rows = state.symbols ? ['1234567890', '@#$%&*-=()', '!"\':;/?', ''] : ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
      const letters = row => row.split('').map(k => { const c = state.shift && !state.symbols ? k.toUpperCase() : k; return b(c, c.replace(/[&<>"]/g, x => `&#${x.charCodeAt(0)};`)); }).join('');
      return `<div class="gbkb gbkb-qwerty apk-kb-gb">${rows.map((row, i) => i < 3 ? `<div class="${i === 2 && !state.symbols ? 'gbkb-inset' : ''}">${letters(row)}</div>`
        : `<div>${icon('shift', state.shift ? 'sym_keyboard_shift_locked' : 'sym_keyboard_shift', 'gbkb-wide')}${letters(row)}${row ? '' : '<span class="gbkb-fill"></span>'}${icon('delete', 'sym_keyboard_delete', 'gbkb-wide')}</div>`).join('')}<div>${b('symbols', state.symbols ? 'ABC' : '?123', 'gbkb-double')}${b(',', ',')}${b('-', '-')}${icon('space', 'sym_keyboard_space', 'gbkb-double')}${b('=', '=')}${b('.', '.')}${icon('next', 'sym_keyboard_ok', 'gbkb-double')}</div></div>`;
    }
    function html() {
      const el = state.field, number = el && (el.type === 'number' || el.type === 'tel');
      if (version === '2.3.6') return gingerbread(number);
      const ime = version === '5.1.1' ? window.LPIme : window.KKIme;
      if (!ime) return '';
      let out = ime.render({mode: number ? 'number' : 'alpha', shift: state.shift, symbols: state.symbols, more: state.more, action: el?.form || el?.tagName === 'TEXTAREA' ? 'done' : 'done', lang: lang()});
      out = out.replace(/data-lock-key=/g, 'data-apk-key=');
      if (BORROW) out = out.replace(/src="assets\/kime-/g, 'src="../4.4.4/assets/kime-');
      return out;
    }
    function draw() {
      if (!root) return;
      root.innerHTML = html();
      const viewport = document.querySelector('#viewport');
      if (viewport) viewport.style.bottom = `${root.offsetHeight}px`;
    }
    function open(el) {
      if (state.field !== el) { state.shift = false; state.symbols = false; state.more = false; }
      state.field = el;
      const screen = document.querySelector('#screen'); if (!screen) return;
      // A keyguard draws its own keyboard: leave that one alone.
      if (screen.querySelector('.credential-keyboard, .kime:not(#apk-kb .kime)')) return;
      if (!root) {
        root = document.createElement('div'); root.id = 'apk-kb'; root.className = `apk-kb v${version.replace(/\./g, '')}`;
        root.addEventListener('pointerdown', onKey); root.addEventListener('mousedown', e => e.preventDefault());
        root.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
        screen.append(root);
        const viewport = document.querySelector('#viewport'); saved = viewport ? viewport.style.bottom : null;
      }
      draw();
      setTimeout(() => el.scrollIntoView?.({block: 'nearest'}), 50);
    }
    function close() {
      root?.remove(); root = null; state.field = null;
      const viewport = document.querySelector('#viewport'); if (viewport && saved !== null) viewport.style.bottom = saved; saved = null;
    }
    function fire(el) { el.dispatchEvent(new Event('input', {bubbles: true})); }
    function insert(text) {
      const el = state.field; if (!el) return;
      try {
        const a = el.selectionStart, b = el.selectionEnd;
        if (a == null) throw new Error('no selection');
        el.setRangeText(text, a, b, 'end');
      } catch (error) { el.value += text; }
      fire(el);
    }
    function erase() {
      const el = state.field; if (!el) return;
      try {
        let a = el.selectionStart, b = el.selectionEnd;
        if (a == null) throw new Error('no selection');
        if (a === b) { if (!a) return; a -= 1; }
        el.setRangeText('', a, b, 'end');
      } catch (error) { el.value = el.value.slice(0, -1); }
      fire(el);
    }
    function onKey(event) {
      const key = event.target.closest('[data-apk-key]'); if (!key) return;
      event.preventDefault(); event.stopPropagation();
      const k = key.dataset.apkKey, el = state.field;
      if (k === 'shift') state.shift = state.shift ? (state.shift === true ? 'lock' : false) : true;
      else if (k === 'symbols') { state.symbols = !state.symbols; state.more = false; }
      else if (k === 'more') state.more = !state.more;
      else if (k === 'delete') erase();
      else if (k === 'space') insert(' ');
      else if (k === 'next' || k === 'enter' || k === 'done') {
        if (el?.tagName === 'TEXTAREA') insert('\n');
        else if (el) {
          const down = new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true});
          const go = el.dispatchEvent(down);
          el.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
          if (go && el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})); }
          el.dispatchEvent(new Event('change', {bubbles: true}));
          if (document.activeElement === el) el.blur();
          close();
          return;
        }
      } else { insert(k); if (state.shift === true) state.shift = false; }
      draw();
    }
    document.addEventListener('focusin', event => { if (eligible(event.target)) open(event.target); }, true);
    document.addEventListener('focusout', () => setTimeout(() => { if (!eligible(document.activeElement)) close(); }, 0), true);
    // Back closes the keyboard first, as on a phone.
    window.apkKeyboardBack = () => { if (!root) return false; const el = state.field; close(); el?.blur?.(); return true; };
  }
  if (bridge) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', siteKeyboard); else siteKeyboard(); }


  /* The phone's camera in every version's Camera app (2.3.6 has its own, gb-real-camera.js): a live <video> over the
     drawn viewfinder while it is on screen, and each shutter press also saves a real picture to the phone's gallery. */
  function liveCamera() {
    const version = (location.pathname.match(/versions\/([\d.]+)\//) || [])[1] || '';
    if (version === '2.3.6' || !navigator.mediaDevices?.getUserMedia) return;
    const PREVIEW = '.camera-preview, .jbcam-preview, .gcam-preview, .mmcm-preview, .ngcm-preview, .eccm-preview';
    const video = document.createElement('video');
    video.className = 'apk-live'; video.muted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;pointer-events:none;background:#000';
    let stream = null, starting = null, refused = false;
    const stop = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; starting = null; video.srcObject = null; video.remove(); };
    const start = () => {
      if (starting || stream) return;
      starting = navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 960}}})
        .then(s => { if (!starting) { s.getTracks().forEach(t => t.stop()); return; } stream = s; video.srcObject = s; video.play().catch(() => {}); }, () => { refused = true; starting = null; });
    };
    function sync() {
      const preview = !document.hidden && document.querySelector(`#viewport ${PREVIEW.split(', ').join(', #viewport ')}`);
      if (!preview) { if (stream || starting) stop(); return; }
      if (refused) return;
      start();
      // A viewfinder that is itself a drawn picture (2.1's canvas): the video goes beside it, over its place, before
      // the buttons that follow. Otherwise it goes inside the viewfinder.
      const beside = preview.tagName === 'CANVAS' || preview.tagName === 'IMG';
      if (beside) {
        const parent = preview.parentElement;
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        let after = preview; while (after.nextElementSibling && /^(svg|CANVAS|IMG)$/i.test(after.nextElementSibling.tagName) && after.nextElementSibling !== video) after = after.nextElementSibling;
        Object.assign(video.style, {inset: 'auto', left: `${preview.offsetLeft}px`, top: `${preview.offsetTop}px`, width: `${preview.offsetWidth}px`, height: `${preview.offsetHeight}px`, zIndex: getComputedStyle(preview).zIndex});
        if (after.nextSibling !== video) { after.after(video); if (video.srcObject) video.play().catch(() => {}); }
      } else {
        Object.assign(video.style, {inset: '0', left: '', top: '', width: '100%', height: '100%', zIndex: '1'});
        if (getComputedStyle(preview).position === 'static') preview.style.position = 'relative';
        if (video.parentNode !== preview) { preview.append(video); if (video.srcObject) video.play().catch(() => {}); }
      }
    }
    let frame = 0;
    new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); }); }).observe(document.documentElement, {subtree: true, childList: true});
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', stop);
    // The shutter: a full picture of the live view to the phone's gallery (the simulator keeps its own copy too).
    const snap = () => {
      if (!stream || !video.videoWidth) return;
      const canvas = document.createElement('canvas'), vw = video.videoWidth, vh = video.videoHeight;
      canvas.width = vw; canvas.height = vh;
      canvas.getContext('2d').drawImage(video, 0, 0, vw, vh);
      try { bridge.savePhoto?.(canvas.toDataURL('image/jpeg', .9)); } catch (error) { /* saving is a bonus */ }
    };
    document.addEventListener('click', event => {
      const el = event.target.closest?.('[data-action]');
      if (el && /(^|-)(shoot|shutter)$/.test(el.dataset.action)) snap();
    }, true);
    // 4.3 and 4.4.4 take the picture on the press itself.
    document.addEventListener('pointerdown', event => { if (event.target.closest?.('[data-jbcam-shutter]')) snap(); }, true);
  }
  if (bridge) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liveCamera); else liveCamera(); }

  /* The microphone on every Google search bar and in the Google app: Android's own speech recognition (the Google
     "Speak now" window), then the words go into the version's search box and are searched. */
  function voiceSearch() {
    const MIC = ['voice-search', 'eclh-voice', 'mmh-voice', 'ngh-voice', 'mmgg-voice', 'ga-voice-listen', 'voice-listen', 'gbw-voice-open'];
    let pending = null;
    document.addEventListener('click', event => {
      const mic = event.target.closest?.('[data-action]');
      if (!mic || !MIC.includes(mic.dataset.action) || !bridge.listen) return;
      if (mic.dataset.apkVoice === 'pass') { delete mic.dataset.apkVoice; return; }
      event.preventDefault(); event.stopImmediatePropagation();
      pending = mic;
      let ok = false;
      try { ok = !!bridge.listen((navigator.language || 'en').slice(0, 5)); } catch (error) { ok = false; }
      // No speech recognition on the phone: the version's own (simulated) voice search.
      if (!ok) { mic.dataset.apkVoice = 'pass'; mic.click(); }
    }, true);
    const field = () => [...document.querySelectorAll('#screen input[type="search"], #screen input[type="text"], #screen input:not([type]), #screen textarea')]
      .find(el => el.offsetParent && !el.disabled && !el.readOnly);
    function type(el, text) {
      el.focus();
      el.value = text; el.dispatchEvent(new Event('input', {bubbles: true}));
      const enter = new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true});
      if (el.dispatchEvent(enter) && el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})); }
      el.dispatchEvent(new Event('change', {bubbles: true}));
      window.apkKeyboardBack?.();
      // The version's own keyboard (6.0.1, 7.1.2, 2.1) goes down with the search.
      window.MM?.ime?.hide?.(); el.blur();
      setTimeout(() => { window.MM?.ime?.hide?.(); if (document.activeElement === el) el.blur(); }, 400);
    }
    window.apkHeard = text => {
      const mic = pending; pending = null;
      text = String(text || '').trim();
      if (!text) return;
      // A search box already on screen (the Google app): fill it in. Otherwise open the bar's search screen first.
      let el = field();
      if (el) { type(el, text); return; }
      const box = mic?.parentElement?.closest('form, [class*="search"], [class*="qsb"], [class*="sbar"], .home-search') || mic?.parentElement;
      const open = box && [...box.querySelectorAll('[data-action]')].find(n => n !== mic && !MIC.includes(n.dataset.action));
      open?.click();
      let tries = 0;
      const wait = setInterval(() => { el = field(); if (el || ++tries > 20) { clearInterval(wait); if (el) type(el, text); } }, 100);
    };
  }
  if (bridge) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', voiceSearch); else voiceSearch(); }

  window.RealLauncher = {
    active: !!bridge,
    VERSIONS,
    all: () => all,
    shown: () => { const ids = shownIds(); return all.filter(app => ids.includes(app.id)); },
    isShown: id => shownIds().includes(id),
    // Hide or unhide one real app in the drawer.
    toggle(id) { const ids = shownIds(); store({shown: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]}); },
    setShown(ids) { store({shown: ids.filter(id => all.some(app => app.id === id))}); },
    starters,
    // The icon's full address (served by the APK at <site>/real-icon/<file>).
    iconUrl: app => `${ROOT}real-icon/${encodeURIComponent(String(app?.file || ''))}`,
    iconUrlFor: id => id === SETTINGS_ID ? `${ROOT}real-icon/${SELF.replace('/', '__')}.png` : `${ROOT}real-icon/${encodeURIComponent(String(all.find(app => app.id === id)?.file || String(id).slice(5).replace('/', '__') + '.png'))}`,
    label: id => id === SETTINGS_ID ? 'Launcher settings' : all.find(app => app.id === id)?.label || '',
    // The drawer's real entries: the shown apps, then Launcher settings (versions 4.0.4 and later, launcher-mode.js).
    SETTINGS_ID,
    drawer: () => [...window.RealLauncher.shown(), {id: SETTINGS_ID, label: 'Launcher settings', file: SELF.replace('/', '__') + '.png'}],
    launch: id => { try { bridge?.launch(String(id).slice(5)); } catch (error) { /* the app may have been removed */ } },
    // A real phone call: 'incall' when it shows on the launcher's own call screen (the default phone app).
    call: number => { try { return String(bridge?.call?.(String(number)) ?? ''); } catch (error) { return ''; } },
    version: () => { try { return String(bridge?.version?.() || '2.3.6'); } catch (error) { return '2.3.6'; } },
    setVersion: version => { try { bridge?.setVersion?.(version); } catch (error) { /* not in the APK */ } },
    defaults: () => { try { return JSON.parse(bridge?.defaults?.() || '{}'); } catch (error) { return {}; } },
    makeDefault: which => { try { bridge?.makeDefault?.(which); } catch (error) { /* not in the APK */ } }
  };
})();
