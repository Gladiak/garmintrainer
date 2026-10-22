import definitions from '../../../libs/themes.json' with { type: 'json' };
import interfaceColors from '../../../libs/theme-interface.json' with { type: 'json' };

export const DEFAULT_THEME_ID = 'sage-ivory';
export const UI_PALETTE = Object.freeze(interfaceColors);

function mix(base, tint, amount) {
  const channels = (hex) => hex.slice(1).match(/../g).map((value) => parseInt(value, 16));
  const a = channels(base); const b = channels(tint);
  return `#${a.map((value, index) => Math.round(value * (1 - amount) + b[index] * amount).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(a, b) { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function interfaceAccent(accent) {
  // Keep the source accent where possible, choosing readable text for pale yellows.
  let background = accent;
  let foreground = contrast(accent, UI_PALETTE.ink) > contrast(accent, UI_PALETTE.surface) ? UI_PALETTE.ink : UI_PALETTE.surface;
  for (let step = 1; contrast(background, foreground) < 4.5 && step <= 20; step += 1) {
    background = mix(accent, foreground === UI_PALETTE.surface ? UI_PALETTE.ink : UI_PALETTE.surface, step / 20);
  }
  return { background, foreground };
}

export const THEMES = definitions.map((definition) => {
  const c = definition.colors;
  const accent = interfaceAccent(c.accent);
  const accentInk = interfaceAccent(c.chartPrimary).background;
  // Shared grayscale surfaces; theme accents mark actions, navigation and selections.
  return Object.freeze({ ...definition, mode: 'light', palette: Object.freeze({ ...UI_PALETTE,
    sage: c.accent, sageStrong: accent.background, onAccent: accent.foreground,
    accentInk, focusColor: accentInk, accentSoft: mix(UI_PALETTE.surface, c.accent, 0.12),
  }),
    dataPalette: Object.freeze({
      dataPrimary: c.chartPrimary, dataSecondary: c.chartSecondary, dataTertiary: c.chartTertiary,
      dataPrimarySoft: mix(UI_PALETTE.surface, c.chartPrimary, 0.10),
      dataSecondarySoft: mix(UI_PALETTE.surface, c.chartSecondary, 0.10),
      dataTertiarySoft: mix(UI_PALETTE.surface, c.chartTertiary, 0.10),
    }),
    metricColors: Object.freeze({ restingHeartRate: c.chartPrimary, hrv: c.chartSecondary, bodyBattery: c.chartTertiary }),
    sleepColors: Object.freeze({ Profondo: c.sleep[0], Leggero: c.sleep[1], REM: c.sleep[2] }),
  });
});

export function getTheme(id) { return THEMES.find((theme) => theme.id === id) || THEMES[0]; }

export function applyTheme(theme) {
  for (const [name, color] of Object.entries({ ...theme.palette, ...theme.dataPalette })) {
    document.documentElement.style.setProperty(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, color);
  }
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', UI_PALETTE.ivory);
}

export function cachedProfileTheme() {
  try {
    const id = localStorage.getItem('garmintrainer.profileId');
    return getTheme(id ? localStorage.getItem(`garmintrainer.profileTheme:${id}`) : DEFAULT_THEME_ID);
  } catch { return getTheme(DEFAULT_THEME_ID); }
}
