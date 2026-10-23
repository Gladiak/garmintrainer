import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import App from '../App';
import AuthScreen from './AuthScreen';
import { useTheme } from './ThemeProvider';
import { request, setCsrfToken } from '../lib/api';
import { messageText, setProfileLanguage } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';

export default function AccountApp() {
  const { t } = useTranslation();
  const { setProfileTheme } = useTheme();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reset = useCallback(() => {
    setCsrfToken(null); setAccount(null); setProfileTheme(); setProfileLanguage();
    try { localStorage.removeItem('garmintrainer.profileId'); } catch { /* Optional storage. */ }
  }, [setProfileTheme]);
  const authenticated = useCallback(session => {
    setCsrfToken(session.csrfToken);
    setProfileLanguage(session.profile.language, session.profile.id);
    setProfileTheme(session.profile.theme, session.profile.id, session.profile.darkMode);
    setAccount(session);
  }, [setProfileTheme]);
  const restore = useCallback(async signal => {
    setLoading(true); setError(null);
    try { const session = await request('/auth/session', { signal }); if (!signal?.aborted) authenticated(session); }
    catch (failure) { if (!signal?.aborted) { reset(); if (failure.status !== 401) setError(failure); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [authenticated, reset]);
  useEffect(() => {
    const controller = new AbortController();
    restore(controller.signal);
    window.addEventListener('garmintrainer:unauthorized', reset);
    return () => { controller.abort(); window.removeEventListener('garmintrainer:unauthorized', reset); };
  }, [restore, reset]);
  async function logout() {
    try { await request('/auth/logout', { method: 'POST' }); }
    catch (failure) { if (failure.status !== 401) throw failure; }
    reset();
  }
  if (loading) return <main className="auth-loading" role="status"><LoaderCircle size={28} className="spin" /><span>{t('common.loading')}</span></main>;
  if (error) return <main className="auth-loading"><p role="alert">{messageText(error)}</p><button className="button primary" onClick={() => restore()}>{t('common.retry')}</button></main>;
  return account ? <App key={account.user.id} user={account.user} initialProfile={account.profile} onLogout={logout} /> : <AuthScreen onAuthenticated={authenticated} />;
}
