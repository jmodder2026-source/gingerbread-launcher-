/* Launcher APK only: the Gingerbread Settings app drives the phone's real settings and shows their real state.
   The APK reports a snapshot with AndroidLauncher.settings() and applies a change with AndroidLauncher.setSetting(),
   which answers "ok" (changed), "opened" (Android only lets the phone's own Settings change it, so that page opened)
   or "no" (not possible). In an ordinary browser this stays off and the simulator keeps its own settings. */
(() => {
  'use strict';
  const bridge = window.GBRealApps?.active ? window.AndroidLauncher : null;
  const active = !!(bridge?.settings && bridge?.setSetting);

  // Settings whose value comes from the phone, as the simulator stores them.
  const MIRRORED = ['airplane', 'wifi', 'bluetooth', 'gps', 'networkLocation', 'nfc', 'silent', 'ringVolume', 'mediaVolume',
    'alarmVolume', 'notificationVolume', 'brightness', 'autoBrightness', 'screenTimeout', 'rotate', 'haptic', 'soundEffects', 'dtmfTone',
    'autoSync'];
  // Switches the phone handles; any other switch stays a simulator setting.
  const REAL = new Set([...MIRRORED, 'dataEnabled', 'dataRoaming', 'assistedGps', 'usbDebug', 'stayAwake', 'mockLocations',
    'unknownSources', 'bluetoothVisible', 'portableHotspot']);

  function snapshot() {
    try { return JSON.parse(bridge.settings()) || {}; } catch (error) { return {}; }
  }

  // Copy the phone's real values into the simulator's settings (before the Settings app draws).
  function sync(settings) {
    if (!active) return;
    const real = snapshot();
    for (const key of MIRRORED) if (real[key] !== undefined) settings[key] = real[key];
    if (real.silent !== undefined) settings.silentMode = real.vibrate ? 'vibrate' : 'silent';
  }

  function send(key, value) {
    try { return String(bridge.setSetting(key, String(value))); } catch (error) { return 'no'; }
  }

  // Apply one changed setting to the phone. `settings` is the simulator's settings after the change.
  function apply(key, settings) {
    if (!active || !REAL.has(key)) return '';
    if (key === 'silent') {
      // Silent mode follows Gingerbread's Vibrate choice: Always (0) or Only in Silent mode (2) vibrates.
      const vibrate = [0, 2].includes(Number(settings.vibrateMode ?? 2));
      return send('ringer', settings.silent ? (vibrate ? 'vibrate' : 'silent') : 'normal');
    }
    if (key === 'vibrateMode') return settings.silent ? apply('silent', settings) : '';
    return send(key, settings[key]);
  }

  /* A tapped switch: the phone setting flips and the simulator shows the result. Returns true when the switch is the
     phone's, so the simulator's own handling is skipped. */
  function toggle(key, settings) {
    if (!active || !REAL.has(key)) return false;
    settings[key] = !settings[key];
    const result = apply(key, settings);
    if (result !== 'ok') sync(settings); // opened elsewhere or refused: show the real value again
    return true;
  }

  window.GBRealSettings = {active, sync, apply, toggle, isReal: key => active && REAL.has(key)};
})();
