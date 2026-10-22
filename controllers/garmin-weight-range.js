'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieve weight summaries for a date range, including daily latest weights, the range average, and adjacent weights.
module.exports = garminEndpoint({
  "path": "/weight-service/weight/range/{startDate}/{endDate}",
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
    },
    "includeAll": {
      "location": "query",
      "type": "boolean",
      "default": false
    }
  },
  "response": "object",
  "range": [
    "startDate",
    "endDate"
  ],
  "maxDays": 366
});
