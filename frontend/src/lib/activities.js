export const SPORT_LABELS = { running: 'sports.running', cycling: 'sports.cycling', strength: 'sports.strength', walking: 'sports.walking', mobility: 'sports.mobility', swimming: 'sports.swimming' };

export function activityLabel(session, t) {
  const type = session.activityType;
  if (!type) return t('activity.genericActivity');
  const sport = Object.keys(SPORT_LABELS).find(key => type === key || type.includes(key));
  return sport ? t(SPORT_LABELS[sport]) : type.replaceAll('_', ' ');
}
