'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Returns a list of wellness activity summaries for the given date range.
module.exports = garminEndpoint({
  "path": "/wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}",
  "parameters": {
    "fromDate": {
      "location": "path",
      "type": "date",
      "required": true
    },
    "untilDate": {
      "location": "path",
      "type": "date",
      "required": true
    }
  },
  "response": "array",
  "range": [
    "fromDate",
    "untilDate"
  ],
  "maxDays": 366
});
