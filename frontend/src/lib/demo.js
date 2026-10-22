import { shiftDay } from './dates';

// Valori esclusivamente dimostrativi. Non vengono salvati nel database.
export function demoData(endDate) {
  const daily = Array.from({ length: 30 }, (_, index) => ({
    date: shiftDay(endDate, index - 29),
    restingHeartRate: Math.round(56 + 2.7 * Math.sin(index * 0.9) + Math.cos(index * 0.4)),
    hrv: Math.round(47 + index * 0.16 + 5 * Math.sin(index * 0.8)),
    bodyBattery: Math.round(71 + 9 * Math.sin(index * 0.6)),
    stress: Math.round(29 + 6 * Math.sin(index * 0.7)),
    deep: 83 + (index * 7) % 25,
    light: 244 + (index * 11) % 45,
    rem: 83 + (index * 5) % 30,
  }));
  Object.assign(daily.at(-1), { restingHeartRate: 56, hrv: 52, bodyBattery: 78, stress: 28, deep: 98, light: 264, rem: 100 });
  daily[22].hrv = null;
  return daily;
}

export const METRICS = {
  restingHeartRate: { label: 'metrics.restingHeartRate', unit: 'bpm' },
  hrv: { label: 'metrics.hrv', unit: 'ms' },
  bodyBattery: { label: 'metrics.bodyBattery', unit: '/100' },
};
