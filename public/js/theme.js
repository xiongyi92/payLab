const THEMES = [
  { id: 'ocean', name: '深海蓝', bg: '#070b13', swatch: 'linear-gradient(135deg, #38bdf8, #6366f1)' },
  { id: 'violet', name: '星夜紫', bg: '#0a0714', swatch: 'linear-gradient(135deg, #a78bfa, #f472b6)' },
  { id: 'forest', name: '翡翠绿', bg: '#05120e', swatch: 'linear-gradient(135deg, #34d399, #22d3ee)' },
  { id: 'sunset', name: '落日橙', bg: '#140b06', swatch: 'linear-gradient(135deg, #fb923c, #f43f5e)' },
  { id: 'rose', name: '玫瑰粉', bg: '#130710', swatch: 'linear-gradient(135deg, #f472b6, #a78bfa)' },
  { id: 'light', name: '晨雾白', bg: '#eef2f8', swatch: 'linear-gradient(135deg, #0284c7, #e2e8f0)' }
];

const STORAGE_KEY = 'paylab.theme';
const DEFAULT_THEME = 'ocean';

function findTheme(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

function storedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function updatePicker(theme) {
  const name = document.getElementById('theme-name');
  const swatch = document.getElementById('theme-swatch');
  const trigger = document.getElementById('theme-trigger');
  if (name) name.textContent = theme.name;
  if (swatch) swatch.style.background = theme.swatch;
  if (trigger) trigger.setAttribute('aria-label', `颜色主题：${theme.name}`);
  document.querySelectorAll('.theme-option').forEach((option) => {
    option.setAttribute('aria-selected', String(option.dataset.themeId === theme.id));
  });
}

export function applyTheme(id, { persist = true } = {}) {
  const theme = findTheme(id);
  document.documentElement.setAttribute('data-theme', theme.id);
  const meta = document.getElementById('theme-color');
  if (meta) meta.setAttribute('content', theme.bg);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme.id);
    } catch (error) {
      /* 隐私模式下忽略存储失败 */
    }
  }
  updatePicker(theme);
  return theme;
}

export function initThemePicker() {
  const picker = document.getElementById('theme-picker');
  const trigger = document.getElementById('theme-trigger');
  const menu = document.getElementById('theme-menu');
  if (!picker || !trigger || !menu) return;

  menu.innerHTML = THEMES.map((theme) => `
    <button class="theme-option" type="button" role="option" data-theme-id="${theme.id}" aria-selected="false">
      <span class="theme-swatch" style="background:${theme.swatch}"></span>
      <span>${theme.name}</span>
      <span class="theme-check" aria-hidden="true">✓</span>
    </button>
  `).join('');

  applyTheme(storedTheme() || DEFAULT_THEME, { persist: false });

  const open = () => {
    picker.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    const target = menu.querySelector('.theme-option[aria-selected="true"]') || menu.querySelector('.theme-option');
    if (target) target.focus();
  };

  const close = (restoreFocus = true) => {
    picker.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };

  trigger.addEventListener('click', () => {
    if (picker.classList.contains('open')) close();
    else open();
  });

  menu.addEventListener('click', (event) => {
    const option = event.target.closest('.theme-option');
    if (!option) return;
    applyTheme(option.dataset.themeId);
    close();
  });

  document.addEventListener('click', (event) => {
    if (!picker.contains(event.target)) close(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && picker.classList.contains('open')) {
      event.preventDefault();
      close();
    }
  });

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = [...menu.querySelectorAll('.theme-option')];
    const index = options.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    options[(index + step + options.length) % options.length].focus();
  });
}
