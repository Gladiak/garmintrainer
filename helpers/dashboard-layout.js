"use strict";

const catalog = require("../shared/dashboard-modules.json");
const defaults = require("../shared/dashboard-sections.json");
const { InputError } = require("../libs/validation");
const { shiftDate } = require("./garmin-dates");
const { arrangeModules, overlaps, GRID_COLUMNS, MAX_GRID_ROWS } = require("../shared/dashboard-grid.mjs");

const defaultLayout = {
  version: 3,
  sections: Object.fromEntries(Object.entries(defaults).map(([view, types]) => [view,
    arrangeModules(types.map(type => ({ id: `${view}-${type}`, type }))),
  ])),
};

function validateLayout(input) {
  // Old HTTP clients remain supported; all writes use the geometric v3 format.
  if (input?.version === 1 && Array.isArray(input.modules)) {
    input = { version: 2, sections: {
      overview: input.modules.filter(module => module?.type !== "planner"),
      wellness: defaultLayout.sections.wellness,
    } };
  }
  if (![2, 3].includes(input?.version) || !input.sections || typeof input.sections !== "object" || Array.isArray(input.sections)) {
    throw new InputError("Layout non valido.", 400, "INVALID_INPUT");
  }
  const legacy = input.version === 2;
  const sections = {};
  const ids = new Set();
  for (const view of ["overview", "wellness"]) {
    const modules = input.sections[view];
    const limit = legacy ? 32 : Object.values(catalog).filter(item => item.sections.includes(view)).length;
    if (!Array.isArray(modules) || modules.length > limit) throw new InputError("Layout non valido.", 400, "INVALID_INPUT");
    let normalized = modules.map(module => {
      const oldSummary = legacy && view === "overview" && module?.type === "training-summary";
      if (!module || (!oldSummary && (!Object.hasOwn(catalog, module.type) || !catalog[module.type].sections.includes(view)))
        || typeof module.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(module.id) || ids.has(module.id)) {
        throw new InputError("Modulo non valido.", 400, "INVALID_INPUT");
      }
      ids.add(module.id);
      const item = { id: module.id, type: module.type };
      if (!legacy) {
        const bounds = catalog[item.type].grid;
        for (const field of ["x", "y", "w", "h"]) {
          if (!Number.isSafeInteger(module[field])) throw new InputError("Dimensioni non valide.", 400, "INVALID_INPUT");
          item[field] = module[field];
        }
        if (item.x < 0 || item.y < 0 || item.w < bounds.minW || item.w > bounds.maxW
          || item.h < bounds.minH || item.h > bounds.maxH || item.x + item.w > GRID_COLUMNS || item.y + item.h > MAX_GRID_ROWS) {
          throw new InputError("Dimensioni non valide.", 400, "INVALID_INPUT");
        }
      }
      return item;
    });
    if (legacy && view === "overview") {
      // Prefer the recorded activity panel when merging the obsolete summary.
      let activities = normalized.some(module => module.type === "activities");
      normalized = normalized.flatMap(module => {
        if (module.type !== "training-summary") return [module];
        if (activities) return [];
        activities = true;
        return [{ ...module, type: "activities" }];
      });
    }
    const types = new Set();
    normalized = normalized.filter(module => {
      if (types.has(module.type)) {
        if (legacy) return false; // Keep the first instance of an old duplicate.
        throw new InputError("Modulo duplicato.", 400, "INVALID_INPUT");
      }
      types.add(module.type);
      return true;
    });
    if (legacy) normalized = arrangeModules(normalized);
    else if (normalized.some((item, index) => normalized.slice(0, index).some(previous => overlaps(previous, item)))) {
      throw new InputError("Moduli sovrapposti.", 400, "INVALID_INPUT");
    }
    sections[view] = normalized;
  }
  return { version: 3, sections };
}

function upgradeLayout(input) {
  const layout = validateLayout(input);
  if (input.version !== 1) return layout;
  let overview = layout.sections.overview.filter(module => !["hrv", "sleep", "stress"].includes(module.type));
  // Preserve the existing v1 migration to dedicated wellness and plan pages.
  for (const type of ["training-status", "activities"]) {
    if (!overview.some(module => module.type === type)) {
      let id = `overview-${type}`;
      while (Object.values(layout.sections).flat().some(module => module.id === id) || overview.some(module => module.id === id)) id += "-new";
      overview.push({ id, type });
    }
  }
  layout.sections.overview = arrangeModules(overview);
  return layout;
}

function viewModules(layout, view = "overview") {
  if (!["overview", "wellness", "plan"].includes(view))
    throw new InputError("Sezione non valida.", 400, "INVALID_INPUT");
  if (view === "plan") return [{ id: "planner", type: "planner" }];
  return layout.sections[view];
}

// One union per source; compact cards require only the anchor day.
function moduleRequirements(layout, from, to) {
  const requirements = {};
  for (const module of layout.modules) {
    const definition = catalog[module.type];
    const resources =
      (from === to && definition.dayResources) || definition.resources;
    const start = definition.daily ? to : from;
    for (const resource of resources) {
      const resourceStart = definition.historyDays?.[resource]
        ? shiftDate(to, 1 - definition.historyDays[resource])
        : start;
      const previous = requirements[resource];
      requirements[resource] = {
        from:
          previous && previous.from < resourceStart
            ? previous.from
            : resourceStart,
        to,
      };
    }
  }
  return requirements;
}

module.exports = {
  catalog,
  defaultLayout,
  validateLayout,
  upgradeLayout,
  viewModules,
  moduleRequirements,
};
