'use strict';

const { validateLayout } = require('../helpers/dashboard-layout');

function dashboardLayoutController({ getDatabase }) {
  return async (req, res) => {
    const layout = validateLayout(req.body);
    await getDatabase().saveDashboardLayout(req.profile.id, layout);
    res.json(layout);
  };
}

module.exports = { dashboardLayoutController };
