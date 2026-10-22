'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get user summary data for a specific date.
module.exports = garminEndpoint({
  "path": "/usersummary-service/usersummary/daily",
  "parameters": {
    "calendarDate": {
      "location": "query",
      "type": "date"
    }
  },
  "response": "object"
});
