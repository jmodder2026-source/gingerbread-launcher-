/* Android 2.3.6 SystemUI status bar: status_bar.xml icons, the ticker, the DateView and the status_bar_expanded.xml shade.
   Sizes are dp (calc(N * var(--dp)) in the stylesheets); PX() is one hdpi pixel of the 480 px panel in CSS px now. */
(() => {
  'use strict';
  const PX = () => (globalThis.document?.querySelector?.('#screen')?.clientWidth || 276) / 480;
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // stat_sys_battery.xml level-list: each 5% step covers the levels up to 2 above it (0-2, 3-7, ... 98-100).
  const batteryIcon = (level, charging) => {
    if (charging) return 'gb-stat_sys_battery_charge_anim5.png';
    const step = Math.min(100, Math.max(0, Math.round(Number(level) / 5) * 5));
    return `gb-stat_sys_battery_${step}.png`;
  };
  // config_statusBarIcons order, left to right: bluetooth, mute/volume, wifi, data_connection, phone_signal, battery,
  // alarm_clock. StatusBarService puts every icon in a 25 dp square (status_bar_icon_size).
  function statusIcons(state) {
    const slots = [];
    if (state.bluetooth) slots.push(state.bluetoothConnected ? 'gb-stat_sys_data_bluetooth_connected.png' : 'gb-stat_sys_data_bluetooth.png');
    // GPS tray icon removed
    if (state.headset) slots.push('gb-stat_sys_headset.png');
    if (state.speaker) slots.push('gb-stat_sys_speakerphone.png');
    if (state.micMute) slots.push('gb-stat_sys_mic_mute.png');
    if (state.ringer) slots.push(`gb-stat_sys_ringer_${state.ringer}.png`);
    if (!state.airplane && state.wifi) slots.push(state.wifiLevel === 0 ? 'gb-stat_sys_wifi_signal_0.png' : `gb-stat_sys_wifi_signal_${state.wifiLevel ?? 4}_fully.png`);
    // GPRS (G), EDGE (E), 3G and H: grey arrows while connected, green arrows while data is in use.
    if (!state.airplane && state.data) slots.push(`gb-stat_sys_data_fully_${state.dataActive && ['3g', 'h', 'g', 'e'].includes(state.data) ? 'inandout' : 'connected'}_${state.data}.png`);
    slots.push(state.airplane ? 'gb-stat_sys_signal_flightmode.png' : state.noSim ? 'gb-stat_sys_no_sim.png' : state.signal === null || state.signal === -1 ? 'gb-stat_sys_signal_null.png' : state.roaming ? 'gb-stat_sys_signal_roaming.png' : `gb-stat_sys_signal_${state.signal ?? 4}_fully.png`);
    slots.push(batteryIcon(state.battery ?? 100, state.charging));
    if (state.alarm) slots.push('gb-stat_notify_alarm.png');
    return slots.map(src => `<span class="gbsb-icon"><img src="assets/${src}" alt=""></span>`).join('');
  }
  const notificationIcons = icons => icons.map(src => `<span class="gbsb-icon"><img src="assets/${src}" alt=""></span>`).join('');

  // The bar keeps three layers so a running ticker survives icon updates: icons, ticker, and the DateView shown while
  // the shade is open.
  function bar(root, parts) {
    if (!root.querySelector('.gbsb')) {
      root.innerHTML = `<button class="gbsb" data-action="shade"><span class="gbsb-icons"><span class="gbsb-notifications"></span><span class="gbsb-status"></span><span class="gbsb-clock"></span></span><span class="gbsb-ticker" aria-live="polite"></span><span class="gbsb-date"></span></button>`;
    }
    const button = root.querySelector('.gbsb');
    button.setAttribute('aria-label', parts.label);
    button.querySelector('.gbsb-notifications').innerHTML = notificationIcons(parts.notifications);
    button.querySelector('.gbsb-status').innerHTML = statusIcons(parts.state);
    button.querySelector('.gbsb-clock').textContent = parts.clock;
    button.querySelector('.gbsb-date').textContent = parts.date;
    button.classList.toggle('gbsb-expanded', !!parts.expanded);
  }

  // Ticker.java: each segment shows for TICKER_SEGMENT_DELAY (3 s); push_up_in/out swap it with the icons
  // (config_longAnimTime, 500 ms), push_down_in/out bring the icons back.
  function ticker(root, items, onDone) {
    const button = root.querySelector('.gbsb');
    if (!button || !items.length) return () => {};
    const layer = button.querySelector('.gbsb-ticker');
    let index = 0, timer = 0, stopped = false;
    const show = () => {
      const item = items[index];
      layer.innerHTML = `<span class="gbsb-ticker-segment"><span class="gbsb-icon"><img src="assets/${item.icon}" alt=""></span><span class="gbsb-ticker-text">${e(item.text)}</span></span>`;
    };
    button.classList.add('gbsb-ticking');
    show();
    const advance = () => {
      if (stopped) return;
      index++;
      if (index < items.length) { show(); layer.firstElementChild?.classList.add('gbsb-next'); timer = setTimeout(advance, 3000); return; }
      button.classList.remove('gbsb-ticking'); button.classList.add('gbsb-ticker-done');
      timer = setTimeout(() => { button.classList.remove('gbsb-ticker-done'); layer.innerHTML = ''; onDone?.(); }, 500);
    };
    timer = setTimeout(advance, 3000);
    return () => { stopped = true; clearTimeout(timer); button.classList.remove('gbsb-ticking', 'gbsb-ticker-done'); layer.innerHTML = ''; };
  }

  // status_bar_latest_event.xml (64 sp row + divider) around status_bar_latest_event_content.xml.
  const item = n => `<button class="gbsh-item" data-action="${n.action || 'notification-open'}" data-id="${e(n.id)}"${n.app ? ` data-app="${e(n.app)}"` : ''}><span class="gbsh-row"><img class="gbsh-icon" src="assets/${n.icon}" alt=""><span class="gbsh-title">${e(n.title)}</span></span><span class="gbsh-row"><span class="gbsh-text">${e(n.text)}</span>${n.time ? `<span class="gbsh-time">${e(n.time)}</span>` : ''}</span></button>`;
  // Quick settings row (Wi-Fi, Bluetooth, GPS, Vibrate, Sound) under the shade header: grey when off, pink-red when on.
  const QS_GLYPH = {
    wifi: '<path d="M3 9.5a13 13 0 0 1 18 0M6 12.8a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
    bluetooth: '<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>',
    gps: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5"/>',
    vibrate: '<rect x="8" y="4" width="8" height="16" rx="1.5"/><path d="M5 8v8M2.5 10v4M19 8v8M21.5 10v4"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11"/>'
  };
  const quick = toggles => toggles && toggles.length ? `<div class="gbqt">${toggles.map(q => `<button type="button" class="gbqt-btn${q.on ? ' on' : ''}" data-action="gbqt-toggle" data-id="${e(q.id)}" aria-pressed="${!!q.on}" aria-label="${e(q.label)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${QS_GLYPH[q.id] || ''}</svg></button>`).join('')}</div>` : '';
  function shade(parts) {
    const t = parts.t, ongoing = parts.ongoing || [], latest = parts.latest || [];
    const sections = !ongoing.length && !latest.length
      ? `<div class="gbsh-section">${e(t('No notifications'))}</div>`
      : `${ongoing.length ? `<div class="gbsh-section">${e(t('Ongoing'))}</div>${ongoing.map(item).join('')}` : ''}${latest.length ? `<div class="gbsh-section">${e(t('Notifications'))}</div>${latest.map(item).join('')}` : ''}`;
    return `<div class="gbsh" role="dialog" aria-label="${e(t('Notifications'))}"><div class="gbsh-panel"><div class="gbsh-header"><span class="gbsh-carrier">${e(parts.carrier)}</span><button class="gbsh-clear" data-action="clear-notifications"${parts.clearable ? '' : ' hidden'}>${e(t('Clear'))}</button></div>${quick(parts.toggles)}<div class="gbsh-scroll"><div class="gbsh-list">${sections}</div><div class="gbsh-shadow" aria-hidden="true"></div></div><button class="gbsh-close" data-action="close-overlay" aria-label="${e(t('Close notifications'))}"></button></div></div>`;
  }

  /* StatusBarService.incrementAnim: y += v t + a t^2 / 2 with a = +-2000 px/s^2. animateExpand flings from the top at
     2000 px/s; animateCollapse from the bottom at -2000 px/s. Positions are the panel's bottom edge from the screen top. */
  const ACCEL = () => 2000 * PX();
  function place(panel, y, height) { panel.style.transform = `translateY(${Math.round((y - height) * 100) / 100}px)`; }
  function slide(panel, {from, velocity, accel, top, bottom, reduced}, done) {
    const height = bottom;
    if (reduced) { place(panel, accel > 0 ? bottom : top, height); done?.(accel > 0); return () => {}; }
    let y = from, v = velocity, last = performance.now(), frame = 0;
    const step = now => {
      const t = Math.min(0.05, (now - last) / 1000); last = now;
      y += v * t + 0.5 * accel * t * t; v += accel * t;
      if (y >= bottom) { place(panel, bottom, height); done?.(true); return; }
      if (y <= top && v <= 0) { place(panel, top, height); done?.(false); return; }
      place(panel, y, height); frame = requestAnimationFrame(step);
    };
    place(panel, y, height); frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }
  // performFling: thresholds of 200 px/s and the half-height (closed) or last 25 px (open) decide the direction.
  function flingDirection(expanded, y, velocity, displayHeight) {
    const v = velocity / PX(), h = displayHeight / PX(), yy = y / PX();
    if (expanded) return v > 200 || (yy > h - 25 && v > -200);
    return v > 200 || (yy > h / 2 && v > -200);
  }

  // Draining battery: the legend's very low (red) / low (orange) / partially drained / full icons follow a level that
  // falls 1 % a minute from 78 %. Plugging in is not simulated; at 0 % it stays on the empty icon.
  const drain = (() => {
    let level = 78, timer = 0;
    const listeners = new Set();
    const start = () => { if (timer) return; timer = setInterval(() => { if (level > 0) { level -= 1; listeners.forEach(fn => fn(level)); } }, 60000); };
    return {level: () => level, on: fn => { listeners.add(fn); start(); }, set: v => { level = Math.max(0, Math.min(100, Number(v))); listeners.forEach(fn => fn(level)); }};
  })();

  // Simulated coverage (the phone's real network is used in the APK): the network steps 3G -> EDGE -> GPRS -> 3G -> H every
  // ~24 s with matching signal bars, and the data arrows light up for ~3 s out of every 6 s.
  const net = (() => {
    const types = ['3g', 'e', 'g', '3g', 'h'], bars = [4, 3, 2, 3, 4], listeners = new Set();
    let step = 0, tick = 0, timer = 0;
    const state = {type: types[0], signal: bars[0], active: false};
    const start = () => { if (timer) return; timer = setInterval(() => {
      tick++; state.active = tick % 4 === 1 || tick % 4 === 2;
      if (tick % 16 === 0) { step = (step + 1) % types.length; state.type = types[step]; state.signal = bars[step]; }
      listeners.forEach(fn => fn(state));
    }, 1500); };
    return {state, on: fn => { listeners.add(fn); start(); }, set: (type, signal) => { state.type = type; if (signal != null) state.signal = signal; listeners.forEach(fn => fn(state)); }};
  })();

  window.GBStatusBar = {net, drain, PX, ACCEL, batteryIcon, statusIcons, bar, ticker, shade, slide, place, flingDirection};
})();

/* Tapping a search bar or the Google search widget lights it orange for a moment (the screen changes right after the tap). */
(() => {
  document.addEventListener('pointerdown', event => {
    const bar = event.target.closest?.('.gbqsb-field, [class*="search" i], [class*="qsb" i]');
    if (!bar || bar.tagName === 'INPUT') return;
    bar.classList.add('gb-orange'); setTimeout(() => bar.classList.remove('gb-orange'), 450);
  }, true);
  /* The Google search widget's parts and the search-options cells: the screen used to change on the same tap, so the
     orange press never showed on the phone. The tap now lights the part orange first and acts 160 ms later. */
  const HOLD = '.gbqsb-field, .gbqsb-corpus, .gbqsb-voice, .gbqs-cell';
  document.addEventListener('click', event => {
    const el = event.target.closest?.(HOLD);
    if (!el) return;
    if (el.dataset.pressPass) { delete el.dataset.pressPass; return; }
    event.preventDefault(); event.stopImmediatePropagation();
    el.classList.add('gb-orange');
    setTimeout(() => { el.dataset.pressPass = '1'; el.click(); }, 160);
    setTimeout(() => el.classList.remove('gb-orange'), 450);
  }, true);
})();
