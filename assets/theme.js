(() => {
  const root = document.documentElement;
  const button = document.querySelector('[data-theme-toggle]');
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const storageKey = 'realityforge-theme';

  if (!button) return;

  const applyTheme = (theme, persist = false) => {
    root.dataset.theme = theme;
    const isLight = theme === 'light';
    button.setAttribute('aria-label', isLight ? 'Dark Mode aktivieren' : 'Light Mode aktivieren');
    button.setAttribute('aria-pressed', String(isLight));
    if (metaTheme) metaTheme.content = isLight ? '#f5f3ef' : '#09090d';
    if (persist) {
      try { localStorage.setItem(storageKey, theme); } catch (_) {}
    }
  };

  applyTheme(root.dataset.theme || 'dark');
  button.addEventListener('click', () => {
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      button.click();
    }
  });
})();
