'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieves the activity summary, metadata, measurements, and split summary information for the specified activity.
module.exports = garminEndpoint({
  "path": "/activity-service/activity/{activityId}",
  "parameters": {
    "activityId": {
      "location": "path",
      "type": "id",
      "required": true
    }
  },
  "response": "object"
});
