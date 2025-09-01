class ThemeManager {
  constructor() {
    const saved = window.localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.theme = saved || (prefersDark ? 'dark' : 'light');
    this.apply();
  }

  setTheme(theme) {
    this.theme = theme === 'light' ? 'light' : 'dark';
    window.localStorage.setItem('theme', this.theme);
    this.apply();
  }

  toggleTheme() {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  apply() {
    document.documentElement.setAttribute('data-theme', this.theme);
  }
}

window.ThemeManager = new ThemeManager();
export default window.ThemeManager;

