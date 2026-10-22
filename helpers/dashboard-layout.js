'use strict';

const catalog = require('../shared/dashboard-modules.json');
const defaults = require('../shared/dashboard-sections.json');
const { InputError } = require('../libs/validation');
const { shiftDate } = require('./garmin-dates');

const defaultLayout = { version: 2, sections: Object.fromEntries(Object.entries(defaults)
  .map(([view, types]) => [view, types.map(type => ({ id: `${view}-${type}`, type }))])) };

function validateLayout(input) {
  // Accept old clients, while all saved layouts use separate sections.
  if (input?.version === 1 && Array.isArray(input.modules)) {
    input = { version: 2, sections: { overview: input.modules.filter(module => module?.type !== 'planner'), wellness: defaultLayout.sections.wellness } };
  }
  if (input?.version !== 2 || !input.sections || typeof input.sections !== 'object') throw new InputError('Layout non valido.', 400, 'INVALID_INPUT');
  const sections = {};
  const ids = new Set();
  for (const view of ['overview', 'wellness']) {
    const modules = input.sections[view];
    if (!Array.isArray(modules) || modules.length > 12) throw new InputError('Layout non valido.', 400, 'INVALID_INPUT');
    sections[view] = modules.map(module => {
      const oldSummary = view === 'overview' && module?.type === 'training-summary';
      if (!module || !oldSummary && (!Object.hasOwn(catalog, module.type) || !catalog[module.type].sections.includes(view))
        || typeof module.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(module.id) || ids.has(module.id)) {
        throw new InputError('Modulo non valido.', 400, 'INVALID_INPUT');
      }
      ids.add(module.id);
      return { id: module.id, type: module.type };
    });
    if (view === 'overview') {
      // Merge old saved cards into the existing activities module, preserving its ID and position.
      let activities = sections[view].some(module => module.type === 'activities');
      sections[view] = sections[view].flatMap(module => {
        if (module.type !== 'training-summary') return [module];
        if (activities) return [];
        activities = true;
        return [{ ...module, type: 'activities' }];
      });
    }
  }
  return { version: 2, sections };
}

function upgradeLayout(input) {
  if (input.version !== 1) return validateLayout(input);
  const layout = validateLayout(input);
  // Detailed recovery panels now live in the dedicated wellness section.
  layout.sections.overview = layout.sections.overview.filter(module => !['hrv', 'sleep', 'stress'].includes(module.type));
  // The plan is now a dedicated page. Introduce the new training boxes in old layouts.
  for (const type of ['training-status', 'activities']) {
    if (!layout.sections.overview.some(module => module.type === type) && layout.sections.overview.length < 12) {
      let id = `overview-${type}`;
      while (Object.values(layout.sections).flat().some(module => module.id === id)) id += '-new';
      layout.sections.overview.push({ id, type });
    }
  }
  return layout;
}

function viewModules(layout, view = 'overview') {
  if (!['overview', 'wellness', 'plan'].includes(view)) throw new InputError('Sezione non valida.', 400, 'INVALID_INPUT');
  if (view === 'plan') return [{ id: 'planner', type: 'planner' }];
  return layout.sections[view];
}

// One union per source; compact cards require only the anchor day.
function moduleRequirements(layout, from, to) {
  const requirements = {};
  for (const module of layout.modules) {
    const definition = catalog[module.type];
    const resources = from === to && definition.dayResources || definition.resources;
    const start = definition.daily ? to : from;
    for (const resource of resources) {
      const resourceStart = definition.historyDays?.[resource] ? shiftDate(to, 1 - definition.historyDays[resource]) : start;
      const previous = requirements[resource];
      requirements[resource] = { from: previous && previous.from < resourceStart ? previous.from : resourceStart, to };
    }
  }
  return requirements;
}

module.exports = { catalog, defaultLayout, validateLayout, upgradeLayout, viewModules, moduleRequirements };
