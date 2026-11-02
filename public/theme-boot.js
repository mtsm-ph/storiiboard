// Runs before the first paint so the window never flashes the wrong theme. A plain file, not inline, because
// the app's CSP blocks inline scripts. Mirrors loadSettings (src/core/storage/settings.ts) and resolveTheme
// (src/ui/theme/theme.ts); theme.test.ts checks they agree.
(function () {
  var preference = 'system';
  try {
    var saved = JSON.parse(window.localStorage.getItem('storiiboard.settings') || '{}');
    if (saved && (saved.theme === 'light' || saved.theme === 'dark')) preference = saved.theme;
  } catch {
    // Blocked or corrupt storage: fall back to the OS appearance.
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
