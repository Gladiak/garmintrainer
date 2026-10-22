'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get effective weight goals.
module.exports = garminEndpoint({
  "path": "/goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}",
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
  "response": "object",
  "range": [
    "startDate",
    "endDate"
  ],
  "maxDays": 366
});
