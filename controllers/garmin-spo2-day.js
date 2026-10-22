'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Returns daily SpO2 readings data for a given calendar date.
module.exports = garminEndpoint({
  "path": "/wellness-service/wellness/daily/spo2acclimation/{calendarDate}",
  "parameters": {
    "calendarDate": {
      "location": "path",
      "type": "date",
      "required": true
    }
  },
  "response": "object"
});
