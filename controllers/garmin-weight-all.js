'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieve all weight entries for a specified date range.
module.exports = garminEndpoint({
  "path": "/weight-service/weight/all/{startDate}/{endDate}",
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
  "maxDays": 366
});
