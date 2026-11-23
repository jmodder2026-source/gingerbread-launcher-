/* Android 2.1 in the Gingerbread Launcher APK (window.AndroidLauncher, see ../../launcher-apk.js). Loaded last, before the
   core starts, it turns the Nexus One simulator into the phone's home screen:
   - no boot animation, no site page around the phone, no on-screen keys (the phone's own Back, Home and Menu drive it;
     two quick Back presses open the recent apps);
   - the phone's real apps that Launcher settings shows (Files and Claude by default) join All applications, with their
     real icons; Files and Claude go on the middle home screen once;
   - the status bar shows the real signal, data, Wi-Fi, Bluetooth, ringer, battery and alarm;
   - turning the screen off locks the phone;
   - Menu on the home screen has Launcher settings: the apps in the drawer, the Android version, the default apps;
   - as the default phone app, every real call runs on the 2.1 in-call screen, with SlidingTab Answer / Decline for
     incoming calls (gb-real-calls.js has the same reports for 2.3.6).
   In an ordinary browser nothing here runs. */
(() => {
  'use strict';
  const L = window.RealLauncher, bridge = window.AndroidLauncher;
  if (!L?.active || !window.EC) return;
  const c = EC.context;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);
  const lang = () => (window.AndroidI18n?.language || 'en');
  const tr = table => table[lang()] || table.en;

  // A home screen opens straight away: no boot animation.
  try { sessionStorage.setItem('android-sim-booted-2.1', '1'); } catch (error) { /* storage blocked */ }

  // ---- the phone's real apps ---------------------------------------------------------------------------------------
  const REAL = 'real:';
  const isReal = id => typeof id === 'string' && id.startsWith(REAL);
  const installed = new Map(L.all().map(app => [app.id, app]));
  // EC.apps.list is the array All applications, the home screen and the recent apps read; a real app's icon is served
  // by the APK at /assets/site/real-icon/<file> (assets/../../../ from this page's asset folder).
  const shownIds = new Set(L.shown().map(app => app.id));
  for (const app of L.all()) {
    if (!shownIds.has(app.id)) continue;
    EC.apps.list.push({id: app.id, label: app.label, icon: `../../../real-icon/${app.file}`, view: app.id, real: true});
  }
  const label = EC.apps.label, sorted = EC.apps.sorted;
  EC.apps.label = id => (isReal(id) ? installed.get(id)?.label || '' : label(id));
  EC.apps.sorted = () => sorted().sort((a, b) => EC.apps.label(a.id).localeCompare(EC.apps.label(b.id), c.locale?.() || 'en'));
  // Home screen shortcuts to a real app that is no longer installed are dropped; shortcuts get the real icon too.
  const get = EC.apps.get;
  EC.apps.get = id => get(id) || (isReal(id) && installed.has(id) ? {id, label: installed.get(id).label, icon: `../../../real-icon/${installed.get(id).file}`, view: id, real: true} : undefined);

  // Opening a real app launches it on the phone instead of a simulator screen.
  const open = c.open;
  c.open = (view, sub, opts) => {
    if (isReal(view)) { if (c.ui.overlay) c.closeOverlay(); L.launch(view); return; }
    return open(view, sub, opts);
  };

  // ---- the status bar ------------------------------------------------------------------------------------------------
  const state = {wifi: false, battery: {level: 100, charging: false}, alarm: false,
    phone: {signal: 4, data: '', dataActive: false, noSim: false, airplane: false, wifiLevel: 4, ringer: '', bluetooth: false, bluetoothConnected: false}};
  try { state.wifi = !!bridge.wifiConnected?.(); } catch (error) { /* keep */ }
  try { state.battery = {...state.battery, ...JSON.parse(bridge.battery?.() || '{}')}; } catch (error) { /* keep */ }
  try { state.alarm = !!bridge.alarmSet?.(); } catch (error) { /* keep */ }
  try { state.phone = {...state.phone, ...JSON.parse(bridge.phone?.() || '{}')}; } catch (error) { /* keep */ }
  // The status bar module draws from the settings; the real values go there before each draw.
  function intoSettings() {
    const s = c.data?.settings; if (!s) return;
    Object.assign(s, {wifi: state.wifi, wifiConnected: state.wifi, bluetooth: !!state.phone.bluetooth, airplane: !!state.phone.airplane,
      ringer: state.phone.ringer || '', battery: Math.round(state.battery.level), charging: !!state.battery.charging});
  }
  const statusRoot = document.querySelector('#status-bar');
  // Then the icons the module always draws the same way: signal, data, Wi-Fi bars, Bluetooth connected, the real alarm.
  function fixIcons() {
    if (!statusRoot) return;
    const p = state.phone;
    for (const img of statusRoot.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (src.endsWith('fw-stat_sys_signal_4.png')) img.setAttribute('src', `assets/${p.noSim ? 'fw-stat_sys_no_sim.png' : `fw-stat_sys_signal_${Math.max(0, Math.min(4, p.signal))}.png`}`);
      else if (src.endsWith('fw-stat_sys_data_connected_3g.png')) {
        if (!p.data) { (img.closest('.ecsb-icon') || img).remove(); continue; }
        const type = p.data === 'h' ? '3g' : p.data;   // 2.1 has no H icon
        img.setAttribute('src', `assets/fw-stat_sys_data_${p.dataActive && type === '3g' ? 'inandout' : 'connected'}_${type}.png`);
      } else if (src.endsWith('fw-stat_sys_wifi_signal_4.png')) img.setAttribute('src', `assets/fw-stat_sys_wifi_signal_${Math.max(0, Math.min(4, p.wifiLevel))}.png`);
      else if (src.endsWith('fw-stat_sys_data_bluetooth.png') && p.bluetoothConnected) img.setAttribute('src', 'assets/fw-stat_sys_data_bluetooth_connected.png');
    }
    const clock = statusRoot.querySelector('.ecsb-clock');
    if (state.alarm && clock && !statusRoot.querySelector('img[src$="fw-stat_notify_alarm.png"]')) {
      const icon = document.createElement('img'); icon.src = 'assets/fw-stat_notify_alarm.png'; icon.alt = ''; icon.className = 'ecsb-real-alarm';
      clock.before(icon);
    }
  }
  let fixing = false;
  if (statusRoot) new MutationObserver(() => { if (fixing) return; fixing = true; fixIcons(); fixing = false; }).observe(statusRoot, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']});
  const refresh = () => { intoSettings(); c.render(); };
  window.gbRealWifi = on => { state.wifi = !!on; refresh(); };
  window.gbRealBattery = (level, charging) => { state.battery = {level: Number(level), charging: !!charging}; refresh(); };
  window.gbRealAlarm = on => { state.alarm = !!on; refresh(); };
  window.gbRealPhone = report => { state.phone = {...state.phone, ...(typeof report === 'string' ? JSON.parse(report) : report)}; refresh(); };
  window.gbRealAppsChanged = () => location.reload();
  window.gbRealWifiNetworks = () => {};

  // ---- keys, lock, recents -------------------------------------------------------------------------------------------
  window.gbxRecents = () => { if (!c.ui.sleeping && c.ui.view !== 'lock' && !c.ui.power) c.overlay('recent'); };
  // Turning the phone's screen off locks the Eclair phone; its lock screen is up when the screen comes back on.
  window.gbLockNow = () => { if (realCall || c.ui.power || c.ui.view === 'lock') return; c.lock(); c.wake(); };
  window.gbOnPause = () => {};
  window.gbOnResume = () => { if (c.ui.view === 'settings') c.render(); };

  // ---- Launcher settings (Menu on the home screen) -------------------------------------------------------------------
  const T = {
    title: {en: 'Launcher settings', hu: 'Indító beállításai', de: 'Launcher-Einstellungen', fr: 'Paramètres du lanceur', es: 'Ajustes del launcher'},
    apps: {en: 'Apps in the drawer', hu: 'Alkalmazások a fiókban', de: 'Apps in der App-Übersicht', fr: 'Applications du tiroir', es: 'Aplicaciones del cajón'},
    version: {en: 'Android version', hu: 'Android-verzió', de: 'Android-Version', fr: 'Version d’Android', es: 'Versión de Android'},
    home: {en: 'Default Home app', hu: 'Alapértelmezett kezdőalkalmazás', de: 'Standard-Startbildschirm-App', fr: 'Application d’accueil par défaut', es: 'Aplicación de inicio predeterminada'},
    phone: {en: 'Default phone app', hu: 'Alapértelmezett telefonalkalmazás', de: 'Standard-Telefon-App', fr: 'Application Téléphone par défaut', es: 'Aplicación de teléfono predeterminada'},
    ok: {en: 'OK', hu: 'OK', de: 'OK', fr: 'OK', es: 'Aceptar'}
  };
  function launcherSettings() {
    const d = L.defaults(), mark = on => (on ? ' ✓' : '');
    const version = L.version();
    c.dialog({title: tr(T.title), icon: 'fw-ic_dialog_menu_generic.png', items: [
      `${tr(T.apps)} (${L.shown().length}/${L.all().length})`, `${tr(T.version)}: ${version}`, tr(T.home) + mark(d.home), tr(T.phone) + mark(d.phone)],
    onItem(index) {
      if (index === 0) appsDialog();
      else if (index === 1) versionDialog();
      else { c.closeOverlay(); L.makeDefault(index === 2 ? 'home' : 'phone'); }
    }});
  }
  function appsDialog() {
    const apps = L.all(), checked = apps.map(app => L.isShown(app.id));
    c.dialog({title: tr(T.apps), icon: null, items: apps.map(app => app.label), choice: 'multi', checked,
      buttons: [{label: tr(T.ok), action: () => { L.setShown(apps.filter((_, i) => checked[i]).map(app => app.id)); location.reload(); }}]});
  }
  function versionDialog() {
    const current = Math.max(0, L.VERSIONS.findIndex(([v]) => v === L.version()));
    c.dialog({title: tr(T.version), icon: null, items: L.VERSIONS.map(([, name]) => name), choice: 'single', checked: current,
      onItem(index) { c.closeOverlay(); if (index !== current) L.setVersion(L.VERSIONS[index][0]); }});
  }
  const homeModule = EC.module('home');
  if (homeModule?.menu) {
    const menu = homeModule.menu;
    homeModule.menu = cc => {
      const show = cc.menu;
      cc.menu = items => show([...items, {label: tr(T.title), icon: 'fw-ic_menu_preferences.png', action: () => launcherSettings()}]);
      try { return menu(cc); } finally { cc.menu = show; }
    };
  }

  // ---- real calls on the 2.1 in-call screen --------------------------------------------------------------------------
  /* The APK reports each call (window.gbRealCall); the screen shows the most urgent one: ringing, dialing, talking, on
     hold. Buttons go back through AndroidLauncher.callAction. Calls end up in the 2.1 call log as incoming (1),
     outgoing (2) or missed (3). */
  const I = () => EC.text('incall');
  const KEYS = [['1', '1_no_vm'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['*', 'star'], ['0', '0'], ['#', 'pound']];
  const TEXT = {
    incoming: {en: 'Incoming call', hu: 'Bejövő hívás', de: 'Eingehender Anruf', fr: 'Appel entrant', es: 'Llamada entrante'},
    answer: {en: 'Answer', hu: 'Fogadás', de: 'Annehmen', fr: 'Répondre', es: 'Responder'},
    decline: {en: 'Decline', hu: 'Elutasítás', de: 'Abweisen', fr: 'Refuser', es: 'Rechazar'},
    callWith: {en: 'Call with', hu: 'Hívás ezzel:', de: 'Anrufen mit', fr: 'Appeler avec', es: 'Llamar con'}
  };
  const calls = new Map();
  let realCall = null, returnTo = null, fromLock = false, timer = 0;
  const elapsed = s => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
  const seconds = call => (call.connected ? Math.max(0, Math.floor(((call.endedAt || Date.now()) - call.connected) / 1000)) : 0);
  const act = (action, value = '') => { try { return String(bridge.callAction(realCall?.id || '', action, String(value))); } catch (error) { return 'no'; } };
  const RANK = {ringing: 0, 'select-account': 1, dialing: 1, active: 2, holding: 3};

  function person(number) {
    const digits = n => String(n).replace(/[^\d+]/g, '').slice(-9);
    for (const p of c.data.contacts || []) {
      for (const r of EC.contactModel?.raws?.(p) || []) for (const x of r.phone || []) if (digits(x.value) === digits(number)) return {...p, phoneLabel: EC.contactModel.typeLabel('phone', x), phone: x.value};
    }
    return null;
  }
  function slider(side, icon, target, confirm, hint) {
    return `<div class="ecst-slider ecst-${side}" data-side="${side}" data-confirm="${confirm}">
      <div class="ecst-bar"><i class="ec-bg ecst-bar-normal np-fw-jog_tab_bar_${side}_end_normal"></i><i class="ec-bg ecst-bar-pressed np-fw-jog_tab_bar_${side}_end_pressed"></i><i class="ec-bg ecst-bar-active np-fw-jog_tab_bar_${side}_end_confirm_${confirm}"></i><span>${esc(hint)}</span></div>
      <img class="ecst-target" src="assets/${target}" alt="">
      <div class="ecst-tab"><img class="ecst-tab-bg" src="assets/fw-jog_tab_${side}_normal.png" alt=""><img class="ecst-icon" src="assets/${icon}" alt=""></div></div>`;
  }
  function render() {
    const call = realCall;
    if (!call) return '<div class="ecic ecic-ended"></div>';
    const st = call.endedAt ? 'ended' : call.state === 'ringing' ? 'incoming' : call.state === 'active' || call.state === 'holding' ? 'active' : 'dialing';
    const who = person(call.number);
    const title = st === 'incoming' ? tr(TEXT.incoming) : I().t({dialing: 'card_title_dialing', active: 'card_title_in_progress', ended: 'card_title_call_ended'}[st]);
    const bg = {dialing: 'unidentified', incoming: 'unidentified', active: 'connected', ended: 'ended'}[st];
    const card = call.dialpad && st === 'active' ? `<div class="ecic-dtmf"><div class="ecic-field">${esc(call.dtmf)}</div><div class="ecic-pad">${KEYS.map(([k, img]) => `<button type="button" class="ecph-key" data-action="ecic-key" data-key="${k}"><i class="ec-bg np-ct-btn_dial_normal"></i><i class="ec-bg ec-pressed np-ct-btn_dial_pressed"></i><img class="wht" src="assets/ct-dial_num_${img}_wht.png" alt="${k}"><img class="blk" src="assets/ct-dial_num_${img}_blk.png" alt=""></button>`).join('')}</div></div>`
      : `<div class="ecic-card"><div class="ecic-title">${esc(title)}</div>
        <div class="ecic-photo-row"><span class="ecic-photo npp-pn-incall_photo_border_lg"><i class="ec-bg np-pn-incall_photo_border_lg"></i><img src="assets/pn-picture_unknown.png" alt=""></span>${st === 'active' || st === 'ended' && call.connected ? `<span class="ecic-time">${esc(elapsed(seconds(call)))}</span>` : ''}</div>
        <div class="ecic-name">${esc(who ? who.name : call.number)}</div>
        ${who ? `<div class="ecic-number"><span>${esc(who.phoneLabel)}</span>${esc(who.phone)}</div>` : ''}</div>`;
    if (st === 'incoming') {
      return `<div class="ecic ecic-incoming"><i class="ecic-bg np-pn-bg_in_call_gradient_${bg}"></i><div class="ecic-main">${card}</div>
        <div class="ecst ecic-slide">${slider('left', 'fw-ic_jog_dial_answer.png', 'fw-jog_tab_target_green.png', 'green', tr(TEXT.answer))}${slider('right', 'fw-ic_jog_dial_decline.png', 'fw-jog_tab_target_red.png', 'red', tr(TEXT.decline))}</div></div>`;
    }
    const off = st === 'ended';
    const btn = (id, text, icon, extra = '') => `<button type="button" class="ecic-btn npp-pn-btn_in_call_main_normal ${extra}" data-action="ecic-${id}"${off ? ' disabled' : ''}><i class="ec-bg np-pn-btn_in_call_main_normal"></i><i class="ec-bg ec-pressed np-pn-btn_in_call_main_pressed"></i>${icon ? `<img src="assets/pn-${icon}.png" alt="">` : ''}<span>${esc(text)}</span></button>`;
    const toggle = (id, text, on, disabled) => `<button type="button" class="ecic-btn ecic-toggle npp-pn-btn_in_call_switch_off_normal" data-action="ecic-${id}"${disabled || off ? ' disabled' : ''}><i class="ec-bg np-pn-btn_in_call_switch_${on ? 'on' : 'off'}_normal"></i><i class="ec-bg ec-pressed np-pn-btn_in_call_switch_${on ? 'on' : 'off'}_pressed"></i><span>${esc(text)}</span></button>`;
    return `<div class="ecic"><i class="ecic-bg np-pn-bg_in_call_gradient_${bg}"></i>
      <div class="ecic-main">${card}</div>
      <div class="ecic-buttons"><div class="ecic-row">${btn('add', I().t('onscreenAddCallText'), 'ic_in_call_touch_add_call')}${btn('end', I().t('onscreenEndCallText'), 'ic_in_call_touch_end', 'end')}${btn('dialpad', I().t(call.dialpad ? 'onscreenHideDialpadText' : 'onscreenShowDialpadText'), call.dialpad ? 'ic_in_call_touch_dialpad_close' : 'ic_in_call_touch_dialpad')}</div>
        <div class="ecic-row">${toggle('bt', I().t('onscreenBluetoothText'), call.bluetooth, !call.bluetoothAvailable)}${toggle('mute', I().t('onscreenMuteText'), call.mute)}${toggle('speaker', I().t('onscreenSpeakerText'), call.speaker)}</div></div></div>`;
  }

  // SlidingTab for the incoming call (as ec-lock.js's): grab a tab, drag past 2/3 of the width to answer or decline.
  let grab = null;
  function mount(cc, root) {
    const bar = root.querySelector('.ecic-slide');
    if (!bar) return;
    const setState = (el, s, side) => {
      el.classList.toggle('pressed', s === 1); el.classList.toggle('active', s === 2);
      el.querySelector('.ecst-tab-bg').src = `assets/fw-jog_tab_${side}_${s === 1 ? 'pressed' : s === 2 ? `confirm_${el.dataset.confirm}` : 'normal'}.png`;
    };
    const move = (el, dx, ms = 0) => { for (const part of el.querySelectorAll('.ecst-tab, .ecst-bar')) { part.style.transition = ms ? `transform ${ms}ms` : 'none'; part.style.transform = `translateX(${dx}px)`; } };
    const release = () => { if (!grab) return; const {el, other, side} = grab; grab = null; move(el, 0, 250); setState(el, 0, side); el.classList.remove('grabbed'); other.classList.remove('hidden'); };
    bar.addEventListener('pointerdown', event => {
      const tab = event.target.closest('.ecst-tab'); if (!tab || grab) return;
      const el = tab.parentElement, side = el.dataset.side, other = bar.querySelector(`.ecst-slider:not(.ecst-${side})`);
      const rect = bar.getBoundingClientRect(), tabRect = tab.getBoundingClientRect();
      grab = {el, side, other, rect, offset: event.clientX - (tabRect.left + tabRect.width / 2), start: tabRect.left + tabRect.width / 2 - rect.left, id: event.pointerId, done: false};
      bar.setPointerCapture?.(event.pointerId); navigator.vibrate?.(30);
      setState(el, 1, side); el.classList.add('grabbed'); other.classList.add('hidden');
      event.preventDefault();
    });
    bar.addEventListener('pointermove', event => {
      if (!grab || event.pointerId !== grab.id || grab.done) return;
      const {el, side, rect} = grab, x = event.clientX - rect.left - grab.offset;
      if (event.clientY < rect.top - 80 || event.clientY > rect.bottom + 80) { release(); return; }
      move(el, side === 'left' ? Math.max(0, x - grab.start) : Math.min(0, x - grab.start));
      if (side === 'left' ? x > 2 / 3 * rect.width : x < rect.width / 3) {
        grab.done = true; navigator.vibrate?.(40); setState(el, 2, side); move(el, side === 'left' ? rect.width : -rect.width, 250);
        const answer = side === 'left';
        setTimeout(() => { grab = null; act(answer ? 'answer' : 'reject'); }, 250);
      }
    });
    for (const type of ['pointerup', 'pointercancel']) bar.addEventListener(type, event => { if (grab && event.pointerId === grab.id && !grab.done) release(); });
  }

  function show() {
    const live = [...calls.values()].filter(call => !call.endedAt).sort((a, b) => RANK[a.state] - RANK[b.state]);
    const next = live[0];
    if (next && realCall !== next && !(realCall && realCall.endedAt)) {
      if (!realCall) { fromLock = c.ui.view === 'lock'; returnTo = c.ui.view === 'lock' || c.ui.view === 'incall' ? null : {view: c.ui.view, sub: c.ui.sub}; }
      realCall = next;
      if (c.ui.view !== 'incall') { if (c.ui.overlay && c.ui.overlay !== 'ui-dialog') c.closeOverlay(); if (c.ui.sleeping) c.wake(); open('incall'); }
    }
    clearInterval(timer);
    timer = setInterval(() => { const el = c.el.viewport.querySelector('.ecic-time'); if (el && realCall) el.textContent = elapsed(seconds(realCall)); }, 1000);
    c.notify?.({id: 'incall', icon: 'fw-stat_sys_phone_call.png', title: I().t('ongoing'), text: realCall ? (person(realCall.number)?.name || realCall.number) : '', ongoing: true, view: 'incall'});
    if (c.ui.view === 'incall') c.render();
  }
  function logCall(call) {
    const type = call.incoming ? (call.answered ? 1 : 3) : 2, number = EC.formatNumber ? EC.formatNumber(call.number) : call.number;
    const rows = c.data.calls || [];
    // An outgoing call was logged by the dialer when it was placed: it gets its duration.
    const placed = type === 2 && rows.find(row => row.type === 2 && !row.duration && String(row.number).replace(/\D/g, '') === String(number).replace(/\D/g, '') && Date.now() - row.when < 3600e3);
    if (placed) placed.duration = seconds(call);
    else c.data.calls = [{id: Date.now(), number, type, when: call.started, duration: seconds(call)}, ...rows];
    c.save();
  }
  function end(call) {
    if (call.endedAt) return;
    call.endedAt = Date.now(); call.dialpad = false;
    logCall(call);
    if (realCall !== call) { calls.delete(call.id); show(); return; }
    c.render();
    setTimeout(() => {
      calls.delete(call.id);
      if (realCall !== call) return;
      realCall = null; clearInterval(timer);
      if ([...calls.values()].some(other => !other.endedAt)) { show(); return; }
      c.cancelNotification?.('incall');
      if (fromLock) { fromLock = false; returnTo = null; c.lock(); c.wake(); return; }
      if (c.ui.view === 'incall') { if (returnTo) open(returnTo.view, returnTo.sub, {replace: true}); else c.back(); }
      returnTo = null;
    }, 2000);
  }
  window.gbRealCall = report => {
    try { report = typeof report === 'string' ? JSON.parse(report) : report; } catch (error) { return; }
    if (!report?.id) return;
    let call = calls.get(report.id);
    if (!call) {
      if (report.state === 'disconnected' || report.state === 'disconnecting') return;
      call = {id: report.id, number: report.number || '', started: Date.now(), connected: 0, incoming: !!report.incoming, dialpad: false, dtmf: ''};
      calls.set(report.id, call);
    }
    if (report.number) call.number = report.number;
    if (report.state === 'disconnected' || report.state === 'disconnecting') { end(call); return; }
    Object.assign(call, {state: report.state, mute: !!report.mute, speaker: !!report.speaker, bluetooth: !!report.bluetooth, bluetoothAvailable: !!report.bluetoothAvailable});
    if (report.state === 'active' || report.state === 'holding') call.answered = true;
    if (report.connectTime > 0) call.connected = report.connectTime; else if (call.answered && !call.connected) call.connected = Date.now();
    if (report.state === 'select-account' && report.accounts?.length && !call.asked) {
      call.asked = true;
      c.dialog({title: tr(TEXT.callWith), icon: null, items: report.accounts, onItem(index) { c.closeOverlay(); try { bridge.callAction(call.id, 'account', String(index)); } catch (error) { /* gone */ } }});
    }
    show();
  };

  // The 2.1 in-call screen, now for real calls. The dialer's c.open('incall') with ui.callNumber places the call.
  EC.register('incall', {
    title: 'Phone',
    noStatus: () => false,
    active: () => realCall?.state === 'active',
    init(cc) {
      const openScreen = cc.open;
      cc.open = (view, sub, opts) => {
        if (view === 'incall' && cc.ui.callNumber) {
          const number = cc.ui.callNumber; cc.ui.callNumber = null;
          let where = '';
          try { where = String(bridge.call(String(number))); } catch (error) { where = ''; }
          // The phone's own call screen takes it (the launcher is not the default phone app): stay where we are.
          if (where !== 'incall') return;
          if (!realCall) return;   // the call screen opens when the phone reports the call
        }
        return openScreen(view, sub, opts);
      };
    },
    render: () => render(),
    mount: (cc, root) => mount(cc, root),
    action(name, el) {
      const call = realCall;
      if (!call || call.endedAt) return false;
      switch (name) {
        case 'ecic-end': act('hangup'); return true;
        case 'ecic-dialpad': call.dialpad = !call.dialpad; c.render(); return true;
        case 'ecic-mute': act('mute', !call.mute); return true;
        case 'ecic-speaker': act('speaker', !call.speaker); return true;
        case 'ecic-bt': act('bluetooth', !call.bluetooth); return true;
        case 'ecic-add': c.back(); return true;
        case 'ecic-key': { const k = el.dataset.key; act('dtmf', k); call.dtmf = (call.dtmf + k).slice(-24); const f = c.el.viewport.querySelector('.ecic-field'); if (f) f.textContent = call.dtmf; return true; }
      }
      return false;
    },
    // Back while ringing does nothing; during a call it leaves the call running behind its notification.
    back: () => realCall?.state === 'ringing'
  });

  // A number tapped in another app: the dialer with it filled in.
  window.gbOpenDialer = number => { c.ui.dialDigits = String(number || '').replace(/[^0-9+*#,;]/g, ''); c.ui.phoneTab = 'dialer'; open('phone'); };

  // The home screen once: Files and Claude in the free row under the search bar of the middle screen.
  const STARTED = 'gingerbread-launcher-eclair-seeded';
  document.addEventListener('DOMContentLoaded', () => {
    intoSettings();
    let seeded = false;
    try { seeded = !!localStorage.getItem(STARTED); } catch (error) { seeded = true; }
    const page = c.data?.home?.pages?.[2];
    if (!seeded && page) {
      const free = [[0, 1], [1, 1], [2, 1], [3, 1]].filter(([x, y]) => !page.some(item => item.x <= x && x < item.x + (item.w || 1) && item.y <= y && y < item.y + (item.h || 1)));
      L.starters().forEach((id, i) => { if (free[i]) page.push({type: 'app', app: id, x: free[i][0], y: free[i][1]}); });
      c.save();
      try { localStorage.setItem(STARTED, '1'); } catch (error) { /* storage blocked */ }
    }
    // A page loaded during a call (the screen came up for an incoming call): the APK sends the calls again.
    try { bridge.callNow?.(); } catch (error) { /* no calls */ }
    setTimeout(() => { intoSettings(); c.render(); }, 0);
  });
})();
