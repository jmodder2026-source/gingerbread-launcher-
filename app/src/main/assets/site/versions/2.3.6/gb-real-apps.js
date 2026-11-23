/* Launcher mode: when the page runs inside the Gingerbread Launcher APK, the app exposes window.AndroidLauncher and the
   simulator shows the phone's real installed apps. Real apps use ids of the form "real:<package>/<activity>".
   In an ordinary browser window.AndroidLauncher is missing and nothing here changes the simulator. */
(() => {
  'use strict';
  const bridge = window.AndroidLauncher || null;
  let list = [];
  if (bridge) {
    try { list = JSON.parse(bridge.apps()) || []; } catch (error) { list = []; }
    document.documentElement.classList.add('apk-launcher');
    // A home screen opens straight away: no boot animation.
    try { sessionStorage.setItem('android-sim-booted-2.3.6', '1'); } catch (error) { /* storage blocked */ }
  }
  const byId = new Map(list.map(app => [app.id, app]));
  // The phone's real Wi-Fi: the launcher reports it now and whenever it connects or drops.
  let wifi = false;
  try { wifi = !!bridge?.wifiConnected?.(); } catch (error) { wifi = false; }
  window.gbRealWifi = on => { wifi = !!on; window.dispatchEvent(new Event('gb-real-wifi')); };
  // The phone's real battery (percent, charging) and whether a real alarm is set.
  let battery = {level: 100, charging: false}, alarm = false;
  try { battery = {...battery, ...JSON.parse(bridge?.battery?.() || '{}')}; } catch (error) { /* keep the defaults */ }
  try { alarm = !!bridge?.alarmSet?.(); } catch (error) { alarm = false; }
  window.gbRealBattery = (level, charging) => { battery = {level: Number(level), charging: !!charging}; window.dispatchEvent(new Event('gb-real-wifi')); };
  // The phone's real status: signal bars (0-4), mobile data type ('', 'g', 'e', '3g' or 'h') and whether data is
  // moving, SIM and airplane mode, Wi-Fi bars (0-4), ringer ('', 'vibrate' or 'silent') and Bluetooth.
  let phone = {signal: 4, data: '', dataActive: false, noSim: false, airplane: false, wifiLevel: 4, ringer: '', bluetooth: false, bluetoothConnected: false};
  try { phone = {...phone, ...JSON.parse(bridge?.phone?.() || '{}')}; } catch (error) { /* keep the defaults */ }
  window.gbRealPhone = state => { phone = {...phone, ...(typeof state === 'string' ? JSON.parse(state) : state)}; window.dispatchEvent(new Event('gb-real-wifi')); };
  window.gbRealAlarm = on => { alarm = !!on; window.dispatchEvent(new Event('gb-real-wifi')); };
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // Files apps on common phones, and Claude: placed on the middle home screen the first time the launcher runs.
  const FILES = ['com.google.android.apps.nbu.files', 'com.google.android.documentsui', 'com.android.documentsui', 'com.sec.android.app.myfiles', 'com.mi.android.globalFileexplorer', 'com.coloros.filemanager', 'com.oneplus.filemanager', 'com.huawei.filemanager'];
  const CLAUDE = ['com.anthropic.claude'];
  const pkg = id => String(id).slice(5).split('/')[0];
  const find = packages => { for (const name of packages) { const app = list.find(item => pkg(item.id) === name); if (app) return app.id; } return null; };
  // Only Files and Claude are shown; every other app on the phone stays hidden.
  const shown = [find(FILES), find(CLAUDE)].filter(Boolean);
  list = list.filter(app => shown.includes(app.id));

  window.GBRealApps = {
    active: !!bridge,
    list: () => list,
    ids: () => list.map(app => app.id),
    has: id => byId.has(id),
    isReal: id => typeof id === 'string' && id.startsWith('real:'),
    name: id => byId.get(id)?.label || '',
    icon: id => `<span class="app-icon"><img src="${e(byId.get(id)?.icon || 'assets/apps.png')}" alt=""></span>`,
    launch: id => { try { bridge?.launch(String(id).slice(5)); } catch (error) { /* the app may have been removed */ } },
    starters: () => shown.slice(),
    // A real phone call (Android asks once for permission to make calls).
    // Returns 'incall' when the launcher is the default phone app (the call then shows on the Gingerbread call screen).
    call: number => { try { return String(bridge?.call?.(String(number)) ?? ''); } catch (error) { return ''; } },
    wifi: () => wifi,
    battery: () => battery,
    alarm: () => alarm,
    phone: () => phone
  };
  // The APK calls this when an app is installed or removed.
  window.gbRealAppsChanged = () => location.reload();
})();
