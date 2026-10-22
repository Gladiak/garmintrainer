'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get daily hydration data for a date range, up to a maximum of 31 days.
module.exports = garminEndpoint({
  "path": "/usersummary-service/stats/hydration/daily/{startDate}/{endDate}",
  "parameters": {
    "startDate": {
      "location": "path",
      "type": "date",
      "required": true
    },
    "endDate": {
      "location": "path",
      "type": "date",
      "required": true
    }
  },
  "response": "array",
  "range": [
    "startDate",
    "endDate"
  ],
  "maxDays": 31
});
