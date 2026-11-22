/* Android 2.3.6 extras that the stock Nexus S never had: a floating Back / Home / Recents bar, page dots on the home
   screen, a "Remove items" mode with a delete button on every home screen item, and the Home screen submenu that turns
   them on and off from the launcher's Menu panel. */
(() => {
  'use strict';
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const DEFAULTS = {floatBar: true, dots: true};
  const prefs = data => ({...DEFAULTS, ...(data.gbExtras || {})});

  // Outline glyphs in the style of the later on-screen navigation bar: triangle, circle and square.
  const GLYPHS = {
    back: '<path d="M16 5.5v13L6 12z"/>',
    home: '<circle cx="12" cy="12" r="6.5"/>',
    recent: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    menu: '<path d="M6 8h12M6 12h12M6 16h12"/>'
  };
  // withMenu: in the launcher APK the Nexus S key row is gone, so the bar carries the Menu key too.
  function floatBar(t, withMenu = false) {
    const keys = [['back', 'back', 'Back'], ['home', 'home', 'Home'], ['recent', 'recent', 'Recent apps'], ...(withMenu ? [['menu', 'menu-key', 'Menu']] : [])];
    return `<div class="gbx-float-pill">${keys.map(([glyph, action, label]) => `<button type="button" class="gbx-float-key gbx-float-${glyph}" data-action="${action}" aria-label="${e(t(label))}"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[glyph]}</svg></button>`).join('')}</div>`;
  }

  // One dot per home screen; the current one is bright. Touching a dot goes to that screen.
  function dots(page, count, t) {
    return `<div class="gbx-dots" role="tablist" aria-label="${e(t('Home screen'))}">${Array.from({length: count}, (_, i) => `<button type="button" class="gbx-dot${i === page ? ' active' : ''}" role="tab" aria-selected="${i === page}" data-action="page" data-id="${i}" aria-label="${e(t('Home screen'))} ${i + 1}"></button>`).join('')}</div>`;
  }

  const removeButton = (action, id, t) => `<button type="button" class="gbx-x" data-action="${action}" data-id="${e(id)}" aria-label="${e(t('Remove'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>`;
  const editBar = t => `<div class="gbx-editbar"><span>${e(t('Touch × to remove an item'))}</span><button type="button" data-action="gbx-edit-done">${e(t('Done'))}</button></div>`;

  // The submenu behind the launcher's "Home screen" Menu item, shown as a Gingerbread list dialog.
  // fixedBar: the APK always shows the floating bar (it holds the Menu key), so it has no switch there.
  function homeSubmenu(data, t, fixedBar = false) {
    const p = prefs(data), state = on => t(on ? 'On' : 'Off');
    return {title: t('Home screen'), icon: 'ic_menu_preferences', items: [
      {action: 'gbx-edit', title: t('Remove items'), summary: t('Show a delete button on apps and widgets'), icon: 'ic_menu_delete'},
      ...(fixedBar ? [] : [{action: 'gbx-toggle', id: 'floatBar', title: t('Floating bar'), summary: state(p.floatBar), icon: 'ic_menu_more'}]),
      {action: 'gbx-toggle', id: 'dots', title: t('Page dots'), summary: state(p.dots), icon: 'ic_menu_view'},
      {action: 'gbx-lock', title: t('Lock screen'), summary: t('Lock the phone now'), icon: 'ic_lock_lock'}
    ]};
  }

  function toggle(data, key) {
    data.gbExtras = {...prefs(data), [key]: !prefs(data)[key]};
  }

  window.GBExtras = {DEFAULTS, prefs, floatBar, dots, removeButton, editBar, homeSubmenu, toggle};
})();
