'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Returns the lastest Fitness Age information as of the target calendar date.
module.exports = garminEndpoint({
  "path": "/fitnessage-service/fitnessage/v2/{calendarDate}",
  "parameters": {
    "calendarDate": {
      "location": "path",
      "type": "date",
      "required": true
    },
    "fullHistoryScan": {
      "location": "query",
      "type": "boolean",
      "default": true
    }
  },
  "response": "array"
});
