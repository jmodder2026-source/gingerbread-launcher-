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
  }
  const byId = new Map(list.map(app => [app.id, app]));
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // Files apps on common phones, and Claude: placed on the middle home screen the first time the launcher runs.
  const FILES = ['com.google.android.apps.nbu.files', 'com.google.android.documentsui', 'com.android.documentsui', 'com.sec.android.app.myfiles', 'com.mi.android.globalFileexplorer', 'com.coloros.filemanager', 'com.oneplus.filemanager', 'com.huawei.filemanager'];
  const CLAUDE = ['com.anthropic.claude'];
  const pkg = id => String(id).slice(5).split('/')[0];
  const find = packages => { for (const name of packages) { const app = list.find(item => pkg(item.id) === name); if (app) return app.id; } return null; };

  window.GBRealApps = {
    active: !!bridge,
    list: () => list,
    ids: () => list.map(app => app.id),
    has: id => byId.has(id),
    isReal: id => typeof id === 'string' && id.startsWith('real:'),
    name: id => byId.get(id)?.label || '',
    icon: id => `<span class="app-icon"><img src="${e(byId.get(id)?.icon || 'assets/apps.png')}" alt=""></span>`,
    launch: id => { try { bridge?.launch(String(id).slice(5)); } catch (error) { /* the app may have been removed */ } },
    // The dock's phone and browser buttons open the phone's own dialer and browser.
    dial: () => { try { bridge?.openDialer(); } catch (error) { /* no dialer */ } },
    browse: () => { try { bridge?.openBrowser(); } catch (error) { /* no browser */ } },
    starters: () => [find(FILES), find(CLAUDE)].filter(Boolean)
  };
  // The APK calls this when an app is installed or removed.
  window.gbRealAppsChanged = () => location.reload();
})();
