// This is a conventional allocation of external volume, not measured muscle activation.
export const WORKOUT_LOAD_VERSION = 1;

export function workoutLoad(exercises = []) {
  let totalLoad = 0; let totalRepetitions = 0; let totalSets = 0;
  let unknownLoad = 0; let missingLoadSets = 0;
  const groups = new Map();
  for (const exercise of exercises) {
    const effective = new Map();
    for (const group of exercise.groups || []) {
      if (!group.id || !['target', 'synergist'].includes(group.role)) continue;
      const weight = group.role === 'target' ? 1 : 0.5;
      const previous = effective.get(group.id);
      if (!previous || weight > previous.weight) effective.set(group.id, { id: group.id, name: group.name, weight });
    }
    const denominator = [...effective.values()].reduce((sum, group) => sum + group.weight, 0);
    for (const set of exercise.sets || []) {
      const reps = Number(set.repetitions);
      if (!Number.isInteger(reps) || reps <= 0) continue;
      totalSets++; totalRepetitions += reps;
      if (set.loadKg === null || set.loadKg === undefined || set.loadKg === '') { missingLoadSets++; continue; }
      const kg = Number(set.loadKg);
      if (!Number.isFinite(kg) || kg < 0) { missingLoadSets++; continue; }
      const load = reps * kg;
      totalLoad += load;
      if (!denominator) { unknownLoad += load; continue; }
      for (const group of effective.values()) {
        const current = groups.get(group.id) || { id: group.id, name: group.name, load: 0 };
        current.load += load * group.weight / denominator;
        groups.set(group.id, current);
      }
    }
  }
  return { version: WORKOUT_LOAD_VERSION, exerciseCount: exercises.length, totalSets, totalRepetitions,
    totalLoad, unknownLoad, missingLoadSets, unknownPercentage: totalLoad ? unknownLoad / totalLoad * 100 : 0,
    groups: [...groups.values()].map(group => ({ ...group, percentage: totalLoad ? group.load / totalLoad * 100 : 0 }))
      .filter(group => group.load > 0).sort((a, b) => b.load - a.load || a.id.localeCompare(b.id)) };
}
