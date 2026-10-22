import { useState } from 'react';
import { Activity, ArrowRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import { LANGUAGES, messageText, setLanguage, translationError } from '../lib/i18n';
import { useTranslation } from '../hooks/useTranslation';
import { request } from '../lib/api';

export default function AuthScreen({ onAuthenticated }) {
  const { t, language } = useTranslation();
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    if (registering && body.password !== body.passwordConfirmation) { setError(translationError('errors.PASSWORD_MISMATCH')); return; }
    setBusy(true);
    try { onAuthenticated(await request(registering ? '/auth/register' : '/auth/login', { method: 'POST', body })); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  return <main className="auth-page">
    <section className="auth-story" aria-label="Garmin Trainer">
      <a className="brand" href="/"><span className="brand-mark"><Activity size={26} /></span><span>garmin<span className="brand-light">trainer</span></span></a>
      <div><div className="eyebrow">{t('auth.eyebrow')}</div><h1>{t('auth.headline')}</h1><p>{t('auth.description')}</p></div>
      <p className="auth-privacy"><ShieldCheck size={20} />{t('auth.privacy')}</p>
    </section>
    <section className="auth-panel">
      <label className="auth-language">{t('profile.language')}<select value={language} onChange={event => setLanguage(event.target.value)}>{LANGUAGES.map(({ code }) => <option key={code} value={code}>{t(`languages.${code}`)}</option>)}</select></label>
      <div className="auth-card">
        <p className="eyebrow">{t('auth.welcome')}</p><h2>{t(registering ? 'auth.registerTitle' : 'auth.loginTitle')}</h2><p>{t(registering ? 'auth.registerSubtitle' : 'auth.loginSubtitle')}</p>
        <form className="session-form" key={registering ? 'register' : 'login'} onSubmit={submit}>
          <fieldset disabled={busy}>
            <label>{t('auth.username')}<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={registering ? 3 : undefined} maxLength={40} pattern={registering ? '[a-zA-Z0-9_.\\-]{3,40}' : undefined} aria-describedby={registering ? 'username-help' : undefined} /></label>
            {registering && <><p className="credential-help" id="username-help">{t('auth.usernameHelp')}</p><label>{t('auth.email')}<input name="email" type="email" autoComplete="email" required maxLength={254} /></label></>}
            <label>{t('auth.password')}<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 15 : undefined} maxLength={128} aria-describedby={registering ? 'password-help' : undefined} /></label>
            {registering && <><p className="credential-help" id="password-help">{t('auth.passwordHelp')}</p><label>{t('auth.confirmPassword')}<input name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={15} maxLength={128} /></label></>}
          </fieldset>
          {error && <p className="form-error" role="alert">{messageText(error)}</p>}
          <button className="button primary auth-submit" disabled={busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}{t(busy ? 'common.loading' : registering ? 'auth.register' : 'auth.login')}</button>
        </form>
        <p className="auth-switch">{t(registering ? 'auth.haveAccount' : 'auth.noAccount')} <button className="text-button" disabled={busy} onClick={() => { setRegistering(!registering); setError(null); }}>{t(registering ? 'auth.login' : 'auth.register')}</button></p>
      </div>
    </section>
  </main>;
}
