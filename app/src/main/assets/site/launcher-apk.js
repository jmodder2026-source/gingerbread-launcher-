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
