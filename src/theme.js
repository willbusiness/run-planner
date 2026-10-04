// Light/dark: follows the system unless the setting says otherwise. The map style switches too.
import { settings } from './settings.js';
import { setTheme, setTrailsVisible, map } from './map/view.js';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
export const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && mq.matches);

export function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#1f2329' : '#ffffff');
  if (map) {
    setTheme(dark ? 'dark' : 'light');
    map.once('styledata', () => setTrailsVisible(settings.trails));
  }
}
mq.addEventListener('change', () => settings.theme === 'auto' && applyTheme());
