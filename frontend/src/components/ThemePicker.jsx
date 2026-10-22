import { useId } from 'react';
import { THEMES } from '../lib/palette';

export default function ThemePicker({ value, onChange }) {
  const labelId = useId();
  return <section className="theme-picker" aria-labelledby={labelId}>
    <div className="theme-picker-heading"><strong id={labelId}>Tema e colori</strong><span>Anteprima immediata</span></div>
    <div className="theme-options" role="radiogroup" aria-labelledby={labelId}>
      {THEMES.map((theme) => <label key={theme.id} className={`theme-option ${value === theme.id ? 'is-selected' : ''}`}>
        <span className="theme-accent" style={{ background: theme.colors.accent }} aria-hidden="true" />
        <span className="theme-option-copy"><strong>{theme.name}</strong><span>{theme.description}</span></span>
        <input type="radio" name="theme" value={theme.id} checked={value === theme.id} onChange={() => onChange(theme.id)} aria-label={theme.name} />
        <span className="theme-swatches" aria-hidden="true">{theme.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>
      </label>)}
    </div>
    <p className="theme-preview-help">Il colore accompagna pulsanti, navigazione e grafici. Le superfici restano chiare, in scala di grigi. Salva impostazioni conferma la scelta; Annulla ripristina il tema salvato.</p>
  </section>;
}
