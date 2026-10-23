import catalog from './dashboard-modules.json' with { type: 'json' };

export const GRID_COLUMNS = 4;
export const MAX_GRID_ROWS = 512;

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function readingOrder(modules) {
  return [...modules].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function gridBounds(type) {
  return catalog[type].grid;
}

// Place legacy modules and newly added components in the first available cells.
export function firstSpace(placed, w, h, columns = GRID_COLUMNS, start = { x: 0, y: 0 }) {
  for (let y = start.y; y <= MAX_GRID_ROWS - h; y += 1) {
    for (let x = y === start.y ? start.x : 0; x <= columns - w; x += 1) {
      const rect = { x, y, w, h };
      if (!placed.some(item => overlaps(item, rect))) return rect;
    }
  }
  throw new RangeError('Dashboard grid is full');
}

export function arrangeModules(modules, columns = GRID_COLUMNS) {
  const placed = [];
  let cursor = { x: 0, y: 0 };
  for (const module of modules) {
    const bounds = gridBounds(module.type);
    const w = Math.min(columns, module.w ?? bounds.w);
    const h = module.h ?? bounds.h;
    const rect = firstSpace(placed, w, h, columns, cursor);
    placed.push({ id: module.id, type: module.type, ...rect });
    // Do not backfill above earlier items: mobile and legacy layouts keep
    // the same visual reading order even with mixed widths and heights.
    cursor = { x: rect.x + w, y: rect.y };
  }
  return placed;
}

export function createModule(modules, type, id) {
  const { w, h } = gridBounds(type);
  return { id, type, ...firstSpace(modules, w, h) };
}

// The manipulated item owns its destination. Colliding neighbours move down
// deterministically; unrelated cells and intentional empty spaces stay intact.
export function changeModule(modules, id, change) {
  const original = modules.find(item => item.id === id);
  if (!original) return modules;
  const bounds = gridBounds(original.type);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
  const w = clamp(change.w ?? original.w, bounds.minW, bounds.maxW);
  const h = clamp(change.h ?? original.h, bounds.minH, bounds.maxH);
  const moved = { ...original, w, h,
    x: clamp(change.x ?? original.x, 0, GRID_COLUMNS - w),
    y: clamp(change.y ?? original.y, 0, MAX_GRID_ROWS - h) };
  const placed = [moved];
  for (const module of readingOrder(modules.filter(item => item.id !== id))) {
    const next = { ...module };
    let collisions;
    while ((collisions = placed.filter(item => overlaps(item, next))).length) {
      next.y = Math.max(...collisions.map(item => item.y + item.h));
    }
    if (next.y + next.h > MAX_GRID_ROWS) return modules;
    placed.push(next);
  }
  const byId = new Map(placed.map(item => [item.id, item]));
  return modules.map(item => byId.get(item.id));
}

// Smaller screens derive their layout without mutating the saved desktop grid.
export function responsiveModules(modules, columns) {
  const ordered = readingOrder(modules);
  return columns === GRID_COLUMNS ? ordered : arrangeModules(ordered, columns);
}

export function moduleGridStyle(module) {
  return { gridColumn: `${module.x + 1} / span ${module.w}`, gridRow: `${module.y + 1} / span ${module.h}` };
}
