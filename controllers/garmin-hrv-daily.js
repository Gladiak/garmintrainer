'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get HRV daily summaries for a date range.
module.exports = garminEndpoint({
  "path": "/hrv-service/hrv/daily/{fromDate}/{toDate}",
  "parameters": {
    "fromDate": {
      "location": "path",
      "type": "date",
      "required": true
    },
    "toDate": {
      "location": "path",
      "type": "date",
      "required": true
    }
  },
  "response": "object",
  "range": [
    "fromDate",
    "toDate"
  ],
  "maxDays": 366
});
