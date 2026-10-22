'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieves daily sleep summaries data for a date range, up to a maximum of 31 days.
module.exports = garminEndpoint({
  "path": "/sleep-service/sleep/dailySleepSummariesByDate",
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
  "response": "array",
  "range": [
    "startDate",
    "endDate"
  ],
  "maxDays": 31
});
