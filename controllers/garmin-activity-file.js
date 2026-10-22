'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Download activity file.
module.exports = garminEndpoint({
  "path": "/download-service/files/activity/{activityId}",
  "parameters": {
    "activityId": {
      "location": "path",
      "type": "id",
      "required": true
    }
  },
  "response": "binary"
});
