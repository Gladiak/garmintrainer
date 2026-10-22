'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Returns daily heart rate data for a given date.
module.exports = garminEndpoint({
  "path": "/wellness-service/wellness/dailyHeartRate",
  "parameters": {
    "date": {
      "location": "query",
      "type": "date"
    }
  },
  "response": "object"
});
