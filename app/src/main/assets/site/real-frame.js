/* Launcher APK, Android 2.3.6 and 2.1: real web pages and real Google Maps inside the simulator.
   The APK lays a second, native WebView over the frame's page area (AndroidLauncher.webLoad / webPlace); this file draws
   the frame around it (a title bar with the address, a progress line, a row of buttons on the Menu key) and keeps the
   native view exactly over its placeholder. Whenever anything of the simulator covers the placeholder (the
   notification shade, a menu, a dialog, the lock screen) the native view hides, since it would otherwise sit on top.
   The Browser and Maps icons open the frame while RealWeb's switches are on; their Menu has "Simulated browser" /
   "Simulated map" to go back to the simulator's own app. Without the APK's web view this file does nothing. */
(() => {
  'use strict';
  const bridge = window.AndroidLauncher || null;
  if (!bridge || typeof bridge.webLoad !== 'function') return;
  const version = (location.pathname.match(/versions\/([\d.]+)\//) || [])[1] || '';
  if (!['2.3.6', '2.1'].includes(version)) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const MAPS_HOME = 'https://www.google.com/maps';
  const BROWSER_HOME = 'https://www.google.com/';
  const ICONS = version === '2.3.6'
    ? {browser: 'assets/browser.png', maps: 'assets/maps.png'}
    : {browser: 'assets/browser.png', maps: 'assets/maps.png'};

  let root = null, kind = 'browser', state = {url: '', title: '', progress: 100, back: false, forward: false}, placed = '', timer = 0;

  const isMaps = url => /^https?:\/\/(www\.)?google\.[a-z.]+\/maps|^https?:\/\/maps\.google\./i.test(url || '');
  const host = url => { try { return new URL(url).host.replace(/^www\./, ''); } catch (error) { return url || ''; } };

  function build() {
    root = document.createElement('div');
    root.id = 'real-frame';
    root.className = `rf rf-v${version.replace(/\./g, '')}`;
    root.innerHTML = `<div class="rf-bar"><img class="rf-icon" alt=""><button type="button" class="rf-address"><span class="rf-title"></span><span class="rf-url"></span></button><form class="rf-edit" hidden><input type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"></form><button type="button" class="rf-reload" aria-label="Reload"></button></div><div class="rf-progress"><i></i></div><div class="rf-page"></div><div class="rf-menu" hidden><button type="button" data-rf="back">Back</button><button type="button" data-rf="forward">Forward</button><button type="button" data-rf="reload">Refresh</button><button type="button" data-rf="home"></button><button type="button" data-rf="sim"></button><button type="button" data-rf="close">Close</button></div>`;
    root.addEventListener('click', onClick);
    root.querySelector('.rf-edit').addEventListener('submit', event => {
      event.preventDefault();
      const text = root.querySelector('.rf-edit input').value.trim();
      editing(false);
      if (text) go(window.RealWeb?.webUrl(text) || window.RealWeb?.search(text) || text);
    });
    const screen = document.querySelector('#screen');
    const viewport = document.querySelector('#viewport');
    if (viewport?.parentNode === screen) viewport.after(root); else screen?.append(root);
  }
  function paint() {
    if (!root) return;
    const maps = kind === 'maps';
    root.classList.toggle('rf-maps', maps);
    root.querySelector('.rf-icon').src = maps ? ICONS.maps : ICONS.browser;
    root.querySelector('.rf-title').textContent = maps ? 'Maps' : (state.title || host(state.url) || 'Browser');
    root.querySelector('.rf-url').textContent = maps ? (state.title || 'Google Maps') : host(state.url);
    root.querySelector('.rf-reload').classList.toggle('stop', state.progress < 100);
    const bar = root.querySelector('.rf-progress');
    bar.classList.toggle('done', state.progress >= 100);
    bar.firstElementChild.style.width = `${Math.max(4, state.progress)}%`;
    root.querySelector('[data-rf="back"]').disabled = !state.back;
    root.querySelector('[data-rf="forward"]').disabled = !state.forward;
    root.querySelector('[data-rf="home"]').textContent = maps ? 'My location' : 'Home';
    root.querySelector('[data-rf="sim"]').textContent = maps ? 'Simulated map' : 'Simulated browser';
  }
  function editing(on) {
    const form = root.querySelector('.rf-edit'), input = form.querySelector('input');
    form.hidden = !on; root.querySelector('.rf-address').hidden = on;
    if (on) { input.value = state.url || ''; input.focus(); input.select(); } else input.blur();
  }
  function menu(show) {
    const m = root?.querySelector('.rf-menu');
    if (!m) return false;
    m.hidden = show === undefined ? !m.hidden : !show;
    return true;
  }
  function onClick(event) {
    const address = event.target.closest('.rf-address');
    if (address) { editing(true); return; }
    if (event.target.closest('.rf-reload')) { if (state.progress < 100) bridge.webStop?.(); else bridge.webReload?.(); return; }
    const button = event.target.closest('[data-rf]');
    if (!button) return;
    menu(false);
    switch (button.dataset.rf) {
      case 'back': bridge.webBack?.(); break;
      case 'forward': bridge.webForward?.(); break;
      case 'reload': bridge.webReload?.(); break;
      case 'home': go(kind === 'maps' ? MAPS_HOME : BROWSER_HOME); break;
      case 'sim': {
        const app = kind === 'maps' ? 'maps' : 'browser';
        if (kind === 'maps') window.RealWeb?.setMaps(false); else window.RealWeb?.setBrowser(false);
        close();
        clickApp(app);
        break;
      }
      case 'close': close(); break;
    }
  }
  // Open the simulator's own app (its icon's click, as the drawer would).
  function clickApp(app) {
    const b = document.createElement('button');
    b.hidden = true; b.dataset.action = 'open-app'; b.dataset.app = app; b.dataset.rfPass = '1';
    document.querySelector('#screen')?.append(b); b.click(); setTimeout(() => b.remove());
  }

  function go(url) { state = {...state, url, progress: 10}; paint(); bridge.webLoad(String(url)); }
  function open(url, as) {
    kind = as || (isMaps(url) ? 'maps' : 'browser');
    if (!root) build();
    root.hidden = false; menu(false); editing(false);
    state = {url, title: '', progress: 10, back: false, forward: false};
    placed = '';
    paint();
    go(url);
    clearInterval(timer); timer = setInterval(sync, 120);
    sync();
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true; clearInterval(timer); timer = 0; placed = '';
    bridge.webClose?.();
  }
  // Keep the native view over the placeholder, or hide it while something of the simulator covers it.
  function sync() {
    if (!root || root.hidden) return;
    root.style.setProperty('--rf-top', `${document.querySelector('#status-bar')?.offsetHeight || 28}px`);
    // The lock screen (the screen went off, or the phone was locked) closes the page.
    if (document.querySelector('#viewport .lock-view, #viewport .ec-lock, #viewport [class*="lockscreen"]')) { close(); return; }
    const page = root.querySelector('.rf-page'), r = page.getBoundingClientRect();
    let visible = r.width > 0 && r.height > 0 && !root.querySelector('.rf-menu:not([hidden])') && root.querySelector('.rf-edit').hidden;
    if (visible) {
      for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.06], [0.1, 0.94], [0.9, 0.94], [0.08, 0.3], [0.92, 0.3]]) {
        const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        if (hit !== page) { visible = false; break; }
      }
    }
    const key = visible ? [r.left, r.top, r.width, r.height].map(n => Math.round(n * 10) / 10).join(',') : 'hidden';
    if (key === placed) return;
    placed = key;
    bridge.webPlace(r.left, r.top, r.width, r.height, visible);
  }

  // The APK reports the page: address, title, progress (0-100) and whether Back / Forward can go anywhere.
  window.gbRealWebState = s => {
    state = {...state, ...(typeof s === 'string' ? JSON.parse(s) : s)};
    if (kind === 'browser' && isMaps(state.url)) kind = 'maps';
    paint();
  };

  // The phone's keys: Back goes back in the page (then closes the frame), Menu shows the frame's buttons, Home closes.
  const ownKey = window.launcherKey;
  window.launcherKey = name => {
    if (root && !root.hidden) {
      if (name === 'back') {
        if (!root.querySelector('.rf-edit').hidden) { editing(false); return true; }
        if (!root.querySelector('.rf-menu').hidden) { menu(false); return true; }
        let went = false;
        try { went = !!bridge.webBack?.(); } catch (error) { went = false; }
        if (!went) close();
        return true;
      }
      if (name === 'menu') { menu(); return true; }
      if (name === 'home') close();
    }
    return ownKey ? ownKey(name) : false;
  };
  // The simulator's own Back / Menu / Home buttons (2.1's soft keys, the 2.3.6 key row) behave the same.
  document.addEventListener('click', event => {
    if (!root || root.hidden) return;
    const key = event.target.closest?.('#nav-bar [data-action], .touch-key[data-action]');
    if (!key) return;
    const action = key.dataset.action;
    const name = action === 'back' ? 'back' : action === 'home' ? 'home' : /menu/.test(action) ? 'menu' : '';
    if (!name) return;
    if (name === 'home') { close(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    window.launcherKey(name);
  }, true);

  // The Browser and Maps icons open the real page while their switches are on.
  document.addEventListener('click', event => {
    const icon = event.target.closest?.('[data-app="browser"], [data-app="maps"]');
    if (!icon || icon.dataset.rfPass || icon.closest('#real-frame')) return;
    if (icon.closest('.recent-item')) return;
    const app = icon.dataset.app;
    const on = app === 'maps' ? window.RealWeb?.mapsOn() : window.RealWeb?.browserOn();
    if (!on) return;
    event.preventDefault(); event.stopImmediatePropagation();
    open(app === 'maps' ? MAPS_HOME : BROWSER_HOME, app);
  }, true);

  window.RealFrame = {open, close, isOpen: () => !!root && !root.hidden};
})();
