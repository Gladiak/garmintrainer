'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get HRV data for a specific date.
module.exports = garminEndpoint({
  "path": "/hrv-service/hrv/{calendarDate}",
  "parameters": {
    "calendarDate": {
      "location": "path",
      "type": "date",
      "required": true
    }
  },
  "response": "object"
});
