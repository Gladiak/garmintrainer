import { useTranslation } from '../hooks/useTranslation';
import { useId } from 'react';
import { THEMES } from '../lib/palette';

export default function ThemePicker({ value, onChange }) {
  const { t } = useTranslation();
  const labelId = useId();
  return <section className="theme-picker" aria-labelledby={labelId}>
    <div className="theme-picker-heading"><strong id={labelId}>{t('themes.title')}</strong><span>{t('themes.preview')}</span></div>
    <div className="theme-options" role="radiogroup" aria-labelledby={labelId}>
      {THEMES.map((theme) => <label key={theme.id} className={`theme-option ${value === theme.id ? 'is-selected' : ''}`}>
        <span className="theme-accent" style={{ background: theme.colors.accent }} aria-hidden="true" />
        <span className="theme-option-copy"><strong>{t(`themes.${theme.id}.name`)}</strong><span>{t(`themes.${theme.id}.description`)}</span></span>
        <input type="radio" name="theme" value={theme.id} checked={value === theme.id} onChange={() => onChange(theme.id)} aria-label={t(`themes.${theme.id}.name`)} />
        <span className="theme-swatches" aria-hidden="true">{theme.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>
      </label>)}
    </div>
    <p className="theme-preview-help">{t('themes.help')}</p>
  </section>;
}
