'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieve the user's heart rate zone configuration.
module.exports = garminEndpoint({
  "path": "/biometric-service/heartRateZones/v2",
  "parameters": {
    "generateDefaults": {
      "location": "query",
      "type": "boolean",
      "default": true
    }
  },
  "response": "array"
});
