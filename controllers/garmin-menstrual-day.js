'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Get detailed menstrual cycle day view.
module.exports = garminEndpoint({
  "path": "/periodichealth-service/menstrualcycle/dayview/{calendarDate}",
  "parameters": {
    "calendarDate": {
      "location": "path",
      "type": "date",
      "required": true
    },
    "todayDate": {
      "location": "query",
      "type": "date"
    },
    "reducedResponse": {
      "location": "query",
      "type": "boolean",
      "default": false
    },
    "skipbm": {
      "location": "query",
      "type": "boolean",
      "default": false
    },
    "includeAnalysis": {
      "location": "query",
      "type": "boolean",
      "default": false
    }
  },
  "response": "object"
});
