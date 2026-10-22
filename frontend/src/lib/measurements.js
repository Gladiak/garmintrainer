export const METRICS = {
  heartRateReferenceBpm: { label: 'metrics.heartReference', unit: 'bpm', color: 'restingHeartRate' },
  hrv: { label: 'metrics.hrv', unit: 'ms', color: 'hrv' },
  bodyBattery: { label: 'metrics.bodyBattery', unit: '/100', color: 'bodyBattery' },
};

export function latestMeasurement(daily, field) {
  return daily.findLast(day => Number.isFinite(day[field])) || null;
}
