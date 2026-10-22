'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieves the user's daily nutrition summary for a specific calendar date.
module.exports = garminEndpoint({
  "path": "/nutrition-service/food/logs/{date}",
  "parameters": {
    "includeGoals": {
      "location": "query",
      "type": "boolean",
      "default": true
    },
    "includeNutrition": {
      "location": "query",
      "type": "boolean",
      "default": true
    },
    "includeMedia": {
      "location": "query",
      "type": "boolean",
      "default": true
    },
    "mealId": {
      "location": "query",
      "type": "integer"
    },
    "date": {
      "location": "path",
      "type": "date",
      "required": true
    }
  },
  "response": "object"
});
