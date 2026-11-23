/* Android 2.3.6 extras that the stock Nexus S never had: a "Remove items" mode with a delete button on every home
   screen item, and Launcher settings (Menu > Launcher settings) with Hide apps for the app drawer. The floating bar and
   page dots are no longer shown. */
(() => {
  'use strict';
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const DEFAULTS = {floatBar: false, dots: false};
  const prefs = data => ({...DEFAULTS, ...(data.gbExtras || {})});

  // Outline glyphs in the style of the later on-screen navigation bar: triangle, circle and square.
  const GLYPHS = {
    back: '<path d="M16 5.5v13L6 12z"/>',
    home: '<circle cx="12" cy="12" r="6.5"/>',
    recent: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>'
  };
  function floatBar(t) {
    const keys = [['back', 'back', 'Back'], ['home', 'home', 'Home'], ['recent', 'recent', 'Recent apps']];
    return `<div class="gbx-float-pill">${keys.map(([glyph, action, label]) => `<button type="button" class="gbx-float-key gbx-float-${glyph}" data-action="${action}" aria-label="${e(t(label))}"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[glyph]}</svg></button>`).join('')}</div>`;
  }

  // One dot per home screen; the current one is bright. Touching a dot goes to that screen.
  function dots(page, count, t) {
    return `<div class="gbx-dots" role="tablist" aria-label="${e(t('Home screen'))}">${Array.from({length: count}, (_, i) => `<button type="button" class="gbx-dot${i === page ? ' active' : ''}" role="tab" aria-selected="${i === page}" data-action="page" data-id="${i}" aria-label="${e(t('Home screen'))} ${i + 1}"></button>`).join('')}</div>`;
  }

  const removeButton = (action, id, t) => `<button type="button" class="gbx-x" data-action="${action}" data-id="${e(id)}" aria-label="${e(t('Remove'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>`;
  const editBar = t => `<div class="gbx-editbar"><span>${e(t('Touch × to remove an item'))}</span><button type="button" data-action="gbx-edit-done">${e(t('Done'))}</button></div>`;

  // Launcher settings, behind the launcher's Menu panel, shown as a Gingerbread list dialog.
  const hidden = data => Array.isArray(data.gbHiddenApps) ? data.gbHiddenApps : [];
  const isHidden = (data, id) => hidden(data).includes(id);
  function homeSubmenu(data, t) {
    const count = hidden(data).length;
    return {title: t('Launcher settings'), icon: 'ic_menu_preferences', items: [
      {action: 'gbx-hidden-menu', title: t('Hide apps'), summary: count ? `${count} ${t(count === 1 ? 'app hidden' : 'apps hidden')}` : t('Choose apps to hide from the app drawer'), icon: 'ic_menu_view'},
      {action: 'gbx-edit', title: t('Remove items'), summary: t('Show a delete button on apps and widgets'), icon: 'ic_menu_delete'},
      {action: 'gbx-lock', title: t('Lock screen'), summary: t('Lock the phone now'), icon: 'ic_lock_lock'}
    ]};
  }
  // Every app the drawer can show ([id, label, icon]); a ticked row is hidden from the drawer.
  function hiddenDialog(data, entries, t) {
    return {title: t('Hide apps'), icon: 'ic_menu_view', choice: 'multi', noTranslate: true,
      items: entries.map(([id, label, icon]) => ({action: 'gbx-hide-app', id, title: label, icon, checked: isHidden(data, id)})),
      buttons: [{action: 'gbx-home-menu', title: t('Done')}]};
  }
  function toggleHidden(data, id) {
    const list = hidden(data);
    data.gbHiddenApps = list.includes(id) ? list.filter(item => item !== id) : [...list, id];
    return data.gbHiddenApps.includes(id);
  }

  function toggle(data, key) {
    data.gbExtras = {...prefs(data), [key]: !prefs(data)[key]};
  }

  window.GBExtras = {DEFAULTS, prefs, floatBar, dots, removeButton, editBar, homeSubmenu, hiddenDialog, toggleHidden, isHidden, toggle};
})();
