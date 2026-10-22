'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieves daily sleep data for a calendar date.
module.exports = garminEndpoint({
  "path": "/sleep-service/sleep/dailySleep",
  "parameters": {
    "date": {
      "location": "query",
      "type": "date"
    }
  },
  "response": "object"
});
