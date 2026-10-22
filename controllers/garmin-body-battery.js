'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Returns daily Body Battery reports for a date range, up to a maximum of 31 days.
module.exports = garminEndpoint({
  "path": "/wellness-service/wellness/bodyBattery/reports/daily",
  "parameters": {
    "startDate": {
      "location": "query",
      "type": "date"
    },
    "endDate": {
      "location": "query",
      "type": "date"
    },
    "chunks": {
      "location": "query",
      "type": "integer"
    }
  },
  "response": "array",
  "range": [
    "startDate",
    "endDate"
  ],
  "maxDays": 31
});
