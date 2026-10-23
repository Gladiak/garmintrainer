import { useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';

// Stable GymFit group IDs are independent of labels and interface language.
const ids = {
  chest: '143d0f71-5c07-4a62-a19d-4a7967adbbfd', shoulders: 'b965bda9-a09a-42b7-a3a2-ca318e505c41',
  biceps: 'd05c796c-19e8-4813-b52f-5deb3b95123d', triceps: 'b557e068-8a28-4bf2-aa8f-68ebc95697ac',
  forearms: '787c8091-75ea-4b57-9639-74629913d1f7', abs: '914abc0f-eb39-45d5-851f-5f79574a7fdd',
  obliques: '37585240-d927-4f24-9c6d-60ecec2edab7', serratus: '0a3a7ad5-02ff-4564-84d3-baaf47abda8e',
  quads: 'b1b79c88-d36f-44d3-b39b-8c7126903e47', adductors: '903edd0a-bd7b-4610-b183-1982cdd73718',
  hip: '73b7d728-6861-408b-a574-a1066332f8e5', tibialis: 'e0ac46cf-8296-4d7b-b5a9-c2bd5e4c483b',
  neck: 'e5c3b90b-95c8-46fc-bd9a-71e114d7743e', traps: 'ac96d968-d938-4385-89f1-321621ea8ac8',
  upper: '4bd4db5c-52e9-4d33-96b8-66085cd463ca', lats: '28162fdc-93e9-42cd-b05b-d758b54d9299',
  lower: 'a34a2b92-4fd1-470d-989c-102ed93b00d2', glutes: '9c7c6e39-6b13-42bd-8de2-6e6b8a1d22be',
  hamstrings: '22b5200d-7c39-4597-b4a2-274b6bf373f9', calves: '3a5b6776-12e1-438c-82bf-65e639f9c4c4',
  rotator: '251c9b6c-6fa7-45ab-a17a-7ffe1565ad85',
};
const labels = { chest: 'Chest', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', abs: 'Abs', obliques: 'Obliques', serratus: 'Serratus', quads: 'Quadriceps', adductors: 'Adductors', hip: 'Hip flexors', tibialis: 'Tibialis', neck: 'Neck', traps: 'Trapezius', upper: 'Upper back', lats: 'Lats', lower: 'Lower back', glutes: 'Glutes', hamstrings: 'Hamstrings', calves: 'Calves', rotator: 'Rotator cuff' };
// Original schematic vector paths: one side is mirrored around the centre line.
const front = [
  ['neck', 'M91 62 L99 70 L98 92 L87 84Z'],
  ['shoulders', 'M69 91 Q48 94 46 119 L62 128 L73 112Z'],
  ['chest', 'M76 94 L98 98 L98 128 Q81 140 65 121Z'],
  ['biceps', 'M46 124 L60 133 L53 166 Q44 177 38 165Z'],
  ['forearms', 'M37 172 L51 175 L38 222 L26 219Z'],
  ['serratus', 'M65 130 L77 139 L75 161 L66 153Z'],
  ['abs', 'M80 140 L98 137 L98 195 L82 191 L78 165Z'],
  ['obliques', 'M65 160 L75 166 L79 195 L91 210 L77 209 L64 185Z'],
  ['hip', 'M70 211 L92 218 L83 236 L65 224Z'],
  ['adductors', 'M92 226 L98 237 L91 291 L80 281Z'],
  ['quads', 'M64 231 L79 241 L79 282 L88 299 L73 309 Q59 281 60 258Z'],
  ['tibialis', 'M72 324 L83 324 L76 387 L66 408 L63 390Z'],
];
const back = [
  ['traps', 'M88 77 L98 73 L98 127 L76 106 L64 96Z'],
  ['shoulders', 'M61 96 L73 108 L61 128 L46 121 Q46 100 61 96Z'],
  ['rotator', 'M72 113 L92 131 L79 142 L65 130Z'],
  ['upper', 'M94 136 L98 139 L98 165 L80 149Z'],
  ['lats', 'M63 140 L76 147 L94 174 L96 199 L77 194 L66 172Z'],
  ['lower', 'M79 199 L96 202 L98 222 L76 220Z'],
  ['triceps', 'M46 126 L60 132 L54 168 L40 169 L37 157Z'],
  ['forearms', 'M37 174 L51 176 L38 221 L26 219Z'],
  ['glutes', 'M71 225 L98 228 L98 256 Q77 266 63 247Z'],
  ['hamstrings', 'M62 260 L79 267 L94 262 L87 307 L72 312 Q62 292 62 260Z'],
  ['calves', 'M72 324 L87 324 L83 355 L72 381 L62 363 L63 340Z'],
];

export function muscleFill(percentage) {
  if (!(percentage > 0)) return 'var(--mist)';
  // A common perceptual curve keeps small shares legible, including in dark mode.
  const intensity = Math.sqrt(Math.min(100, Math.max(0, percentage)) / 100) * 100;
  return `color-mix(in srgb, var(--sage) ${intensity}%, var(--surface))`;
}

export default function MuscleMap({ load, compact = false }) {
  const { t, locale } = useTranslation();
  const [selected, setSelected] = useState(null);
  const values = new Map((load?.groups || []).map(group => [group.id, group]));
  const percent = value => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value || 0)}%`;
  const region = ([key, d], mirror) => {
    const group = values.get(ids[key]);
    return <path key={`${key}-${mirror}`} d={d} transform={mirror ? 'translate(200 0) scale(-1 1)' : undefined}
      fill={muscleFill(group?.percentage)} className={`muscle-region ${selected === ids[key] ? 'is-selected' : ''}`}>
      <title>{labels[key]} · {percent(group?.percentage)}</title>
    </path>;
  };
  return <div className={`muscle-map ${compact ? 'is-compact' : ''}`}>
    <div className="muscle-figures">{[[front, 'front'], [back, 'back']].map(([paths, side]) => <figure key={side}>
      <svg viewBox="12 15 176 420" role="img" aria-label={t(`workouts.body.${side}`)}>
        <g className="body-base"><ellipse cx="100" cy="42" rx="18" ry="23" />
          <path d="M89 66 L88 81 L65 91 Q44 94 41 120 L30 170 L20 218 L19 235 L27 242 L36 237 L41 221 L56 181 L61 155 L63 188 L63 211 Q53 231 57 266 L66 313 L59 357 L60 397 L55 420 Q63 429 77 421 L82 394 L88 356 L92 320 L100 274 L108 320 L112 356 L118 394 L123 421 Q137 429 145 420 L140 397 L141 357 L134 313 L143 266 Q147 231 137 211 L137 188 L139 155 L144 181 L159 221 L164 237 L173 242 L181 235 L180 218 L170 170 L159 120 Q156 94 135 91 L112 81 L111 66Z" />
        </g>
        {paths.flatMap(path => [region(path, false), region(path, true)])}
        {side === 'front' && <g className="body-lines"><path d="M82 154 H98 M81 169 H98 M83 184 H98 M102 154 H118 M102 169 H119 M102 184 H117" /></g>}
      </svg><figcaption>{t(`workouts.body.${side}`)}</figcaption>
    </figure>)}</div>
    {!compact && <>
      <div className="muscle-scale"><span>0%</span><i style={{ background: `linear-gradient(90deg, ${[0, 25, 50, 75, 100].map(muscleFill).join(', ')})` }} /><span>100%</span></div>
      <p className="workout-hint">{t('workouts.mapHint')}</p>
      <div className="muscle-distribution">{(load?.groups || []).map(group => <button key={group.id} type="button" className={selected === group.id ? 'is-selected' : ''}
        aria-pressed={selected === group.id} onClick={() => setSelected(selected === group.id ? null : group.id)}>
        <i style={{ background: muscleFill(group.percentage) }} /><span>{group.name}</span><strong>{percent(group.percentage)}</strong>
      </button>)}{load?.unknownLoad > 0 && <div className="muscle-unmapped"><span>{t('workouts.unmapped')}</span><strong>{percent(load.unknownPercentage)}</strong></div>}</div>
      {!load?.totalLoad && <p className="workout-hint">{t('workouts.noLoad')}</p>}
    </>}
  </div>;
}
