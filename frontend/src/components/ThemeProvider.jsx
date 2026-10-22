import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyTheme, getTheme } from '../lib/palette';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [saved, setSaved] = useState({ id: getTheme().id, darkMode: false });
  const [preview, setPreview] = useState(null);
  const owner = useRef(null);
  const selected = preview || saved;
  const theme = getTheme(selected.id, selected.darkMode);
  const setProfileTheme = useCallback((id, profileId = null, darkMode = false) => {
    if (owner.current !== profileId) setPreview(null);
    owner.current = profileId;
    const theme = getTheme(id, darkMode);
    setSaved({ id: theme.id, darkMode });
    if (profileId) {
      try { localStorage.setItem(`garmintrainer.profileTheme:${profileId}`, theme.id); } catch { /* Optional browser cache. */ }
    }
  }, []);
  const previewTheme = useCallback((id, darkMode = false) => setPreview({ id: getTheme(id).id, darkMode }), []);
  const clearPreview = useCallback(() => setPreview(null), []);
  useLayoutEffect(() => applyTheme(theme), [theme]);
  const value = useMemo(() => ({ theme, palette: theme.palette, metricColors: theme.metricColors, sleepColors: theme.sleepColors,
    setProfileTheme, previewTheme, clearPreview }), [theme, setProfileTheme, previewTheme, clearPreview]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
