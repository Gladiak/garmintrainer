import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { applyTheme, cachedProfileTheme, getTheme } from '../lib/palette';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [savedTheme, setSavedTheme] = useState(() => cachedProfileTheme().id);
  const [preview, setPreview] = useState(null);
  const theme = getTheme(preview || savedTheme);
  const setProfileTheme = useCallback((id, profileId) => {
    const selected = getTheme(id);
    setSavedTheme(selected.id);
    if (profileId) {
      try { localStorage.setItem(`garmintrainer.profileTheme:${profileId}`, selected.id); } catch { /* Optional browser cache. */ }
    }
  }, []);
  const previewTheme = useCallback((id) => setPreview(getTheme(id).id), []);
  const clearPreview = useCallback(() => setPreview(null), []);

  useLayoutEffect(() => applyTheme(theme), [theme]);
  const value = useMemo(() => ({ theme, palette: theme.palette, metricColors: theme.metricColors, sleepColors: theme.sleepColors,
    setProfileTheme, previewTheme, clearPreview }), [theme, setProfileTheme, previewTheme, clearPreview]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
