'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get daily steps data for a date range, up to a maximum of 28 days.
module.exports = garminEndpoint({
  "path": "/usersummary-service/stats/steps/daily/{startDate}/{endDate}",
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
  "maxDays": 28
});
