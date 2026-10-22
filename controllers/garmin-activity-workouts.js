'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieves workouts performed during an activity.
module.exports = garminEndpoint({
  "path": "/activity-service/activity/{activityId}/workouts",
  "parameters": {
    "activityId": {
      "location": "path",
      "type": "id",
      "required": true
    }
  },
  "response": "array"
});
