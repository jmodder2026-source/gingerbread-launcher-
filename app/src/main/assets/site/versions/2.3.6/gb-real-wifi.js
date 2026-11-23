/* Launcher APK only: the Gingerbread Wi-Fi settings list the Wi-Fi networks the phone really sees, show the one it is
   connected to, and connect or forget through the phone. The APK answers:
     AndroidLauncher.wifiScan()            -> "ok", "asking" (location permission prompt shown) or "location-off"
     AndroidLauncher.wifiNetworks()        -> JSON [{name, security: 'Open' | 'WEP' | 'WPA' | 'WPA2', strength: 0-4}]
     AndroidLauncher.wifiCurrent()         -> the connected network's name, or ''
     AndroidLauncher.wifiConnect(name, pw) -> "ok", "opened" (the phone's Wi-Fi page) or "no"
     AndroidLauncher.wifiForget(name)      -> "ok", "opened" or "no"
   and calls window.gbRealWifiNetworks() when a scan finishes or the connection changes. */
(() => {
  'use strict';
  const bridge = window.GBRealApps?.active ? window.AndroidLauncher : null;
  const active = !!(bridge?.wifiScan && bridge?.wifiNetworks);
  const call = (name, ...args) => { try { return String(bridge[name](...args)); } catch (error) { return 'no'; } };

  let networks = [];
  function read() {
    try { networks = (JSON.parse(bridge.wifiNetworks()) || []).filter(item => item && item.name); } catch (error) { networks = []; }
    return networks;
  }
  if (active) read();

  window.GBRealWifi = {
    active,
    networks: () => networks,
    current: () => (active ? call('wifiCurrent') : ''),
    scan: () => (active ? call('wifiScan') : 'no'),
    connect: (name, password) => (active ? call('wifiConnect', name, password || '') : 'no'),
    forget: name => (active ? call('wifiForget', name) : 'no')
  };
  // A finished scan or a change of network: the simulator redraws the Wi-Fi settings if they are open.
  window.gbRealWifiNetworks = () => { read(); window.dispatchEvent(new Event('gb-real-wifi-list')); };
})();
