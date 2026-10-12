// Light / dark theme. 'system' follows the device; the choice is per device (localStorage).
// index.html applies the saved theme before the first paint so the page never flashes white.
import { useEffect, useState } from 'react';

const KEY = 'ma_theme';
export const THEMES = ['system', 'light', 'dark'];
export const THEME_LABEL = { system: 'ตามอุปกรณ์', light: 'โหมดสว่าง', dark: 'โหมดมืด' };

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.includes(t) ? t : 'system';
  } catch {
    return 'system';
  }
}

const isDark = (t) => t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

export function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark(t) ? '#16100c' : '#6f4e37');
}

const EVENT = 'ma:theme';

export function useTheme() {
  const [theme, setThemeState] = useState(getTheme);
  // every toggle on the page shows the same choice
  useEffect(() => {
    const on = () => setThemeState(getTheme());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return undefined;
    // follow the device when it switches between light and dark
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, [theme]);
  const setTheme = (t) => {
    try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
    setThemeState(t);
    window.dispatchEvent(new Event(EVENT));
  };
  return { theme, setTheme, next: () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]) };
}
