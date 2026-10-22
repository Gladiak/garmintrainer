'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get menstrual cycle summary for a date.
module.exports = garminEndpoint({
  "path": "/periodichealth-service/menstrualcycle/summary/{calendarDate}",
  "parameters": {
    "calendarDate": {
      "location": "path",
      "type": "date",
      "required": true
    }
  },
  "response": "object"
});
