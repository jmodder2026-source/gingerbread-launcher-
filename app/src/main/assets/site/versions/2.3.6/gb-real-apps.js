/* Launcher mode: when the page runs inside the Gingerbread Launcher APK, the app exposes window.AndroidLauncher and the
   simulator shows the phone's real installed apps. Real apps use ids of the form "real:<package>/<activity>".
   In an ordinary browser window.AndroidLauncher is missing and nothing here changes the simulator. */
(() => {
  'use strict';
  const bridge = window.AndroidLauncher || null;
  // The phone's apps and which of them the drawer shows come from ../../launcher-apk.js (Launcher settings).
  const L = window.RealLauncher;
  if (bridge) {
    // A home screen opens straight away: no boot animation.
    try { sessionStorage.setItem('android-sim-booted-2.3.6', '1'); } catch (error) { /* storage blocked */ }
  }
  const installed = new Map((L?.all() || []).map(app => [app.id, app]));
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


  window.GBRealApps = {
    active: !!bridge,
    // The real apps the drawer shows (Launcher settings > Apps in the drawer), read fresh each time.
    list: () => L?.shown() || [],
    ids: () => (L?.all() || []).map(app => app.id),
    // Installed: an app placed on the home screen stays there while it is installed, shown in the drawer or not.
    has: id => installed.has(id),
    isReal: id => typeof id === 'string' && id.startsWith('real:'),
    name: id => installed.get(id)?.label || '',
    icon: id => `<span class="app-icon"><img src="${e(installed.has(id) ? L.iconUrl(installed.get(id)) : 'assets/apps.png')}" alt=""></span>`,
    launch: id => L?.launch(id),
    starters: () => L?.starters() || [],
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
