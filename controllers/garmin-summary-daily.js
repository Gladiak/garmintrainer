'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get user daily summaries for a date range, up to a maximum of 1 year.
module.exports = garminEndpoint({
  "path": "/usersummary-service/v2/dailysummaries",
  "parameters": {
    "startDate": {
      "location": "query",
      "type": "date"
    },
    "endDate": {
      "location": "query",
      "type": "date"
    }
  },
  "response": "object",
  "range": [
    "startDate",
    "endDate"
  ],
  "maxDays": 366
});
