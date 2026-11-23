/* Launcher APK, shared by every version it runs (2.3.6 and 2.1): the phone's real apps, which of them the app
   drawer shows (Launcher settings > Apps in the drawer; Files and Claude by default), the Android version and the
   default Home / phone app. The choices live in localStorage under one key, so switching versions keeps them.
   In an ordinary browser window.AndroidLauncher is missing and RealLauncher.active is false. */
(() => {
  'use strict';
  const bridge = window.AndroidLauncher || null;
  const KEY = 'gingerbread-launcher-v1';
  const VERSIONS = [['2.3.6', 'Android 2.3.6 Gingerbread'], ['2.1', 'Android 2.1 Eclair']];
  // Files apps of common phones, then Claude: shown in the drawer until the user picks the apps.
  const FILES = ['com.google.android.apps.nbu.files', 'com.google.android.documentsui', 'com.android.documentsui', 'com.sec.android.app.myfiles',
    'com.mi.android.globalFileexplorer', 'com.coloros.filemanager', 'com.oneplus.filemanager', 'com.huawei.filemanager'];
  const CLAUDE = ['com.anthropic.claude'];

  let all = [];
  if (bridge) {
    try { all = (JSON.parse(bridge.apps()) || []).filter(app => app && app.id); } catch (error) { all = []; }
    all.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    document.documentElement.classList.add('apk-launcher');
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
    // The icon's address from a page at depth `up` below the site root (2 for versions/<v>/index.html).
    iconUrl: (app, up = 2) => `${'../'.repeat(up)}real-icon/${String(app?.file || '')}`,
    launch: id => { try { bridge?.launch(String(id).slice(5)); } catch (error) { /* the app may have been removed */ } },
    version: () => { try { return String(bridge?.version?.() || '2.3.6'); } catch (error) { return '2.3.6'; } },
    setVersion: version => { try { bridge?.setVersion?.(version); } catch (error) { /* not in the APK */ } },
    defaults: () => { try { return JSON.parse(bridge?.defaults?.() || '{}'); } catch (error) { return {}; } },
    makeDefault: which => { try { bridge?.makeDefault?.(which); } catch (error) { /* not in the APK */ } }
  };
})();
