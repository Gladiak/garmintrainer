'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Searches activities using the supplied filters and returns matching paginated activity summaries.
module.exports = garminEndpoint({
  "path": "/activitylist-service/activities/search/activities",
  "parameters": {
    "start": {
      "location": "query",
      "type": "integer",
      "default": 0
    },
    "limit": {
      "location": "query",
      "type": "integer",
      "default": 99
    },
    "favorite": {
      "location": "query",
      "type": "integer",
      "default": -1
    },
    "sortOrder": {
      "location": "query",
      "type": "string",
      "default": "desc"
    },
    "excludeChildren": {
      "location": "query",
      "type": "boolean",
      "default": true
    },
    "sortBy": {
      "location": "query",
      "type": "string"
    },
    "search": {
      "location": "query",
      "type": "string"
    },
    "activityType": {
      "location": "query",
      "type": "string"
    },
    "activitySubType": {
      "location": "query",
      "type": "string"
    },
    "eventType": {
      "location": "query",
      "type": "string"
    },
    "minDistance": {
      "location": "query",
      "type": "integer"
    },
    "maxDistance": {
      "location": "query",
      "type": "integer"
    },
    "minDuration": {
      "location": "query",
      "type": "integer"
    },
    "maxDuration": {
      "location": "query",
      "type": "integer"
    },
    "minElevation": {
      "location": "query",
      "type": "integer"
    },
    "maxElevation": {
      "location": "query",
      "type": "integer"
    },
    "startDate": {
      "location": "query",
      "type": "date"
    },
    "endDate": {
      "location": "query",
      "type": "date"
    },
    "upperLatitude": {
      "location": "query",
      "type": "number"
    },
    "rightLongitude": {
      "location": "query",
      "type": "number"
    },
    "lowerLatitude": {
      "location": "query",
      "type": "number"
    },
    "leftLongitude": {
      "location": "query",
      "type": "number"
    },
    "lowerMaxDepth": {
      "location": "query",
      "type": "integer"
    },
    "upperMaxDepth": {
      "location": "query",
      "type": "integer"
    },
    "decoDive": {
      "location": "query",
      "type": "boolean"
    },
    "minElapsedDuration": {
      "location": "query",
      "type": "integer"
    },
    "maxElapsedDuration": {
      "location": "query",
      "type": "integer"
    },
    "minBottomTime": {
      "location": "query",
      "type": "integer"
    },
    "maxBottomTime": {
      "location": "query",
      "type": "integer"
    },
    "minAvgPower": {
      "location": "query",
      "type": "integer"
    },
    "excludedActivitySubType": {
      "location": "query",
      "type": "array"
    },
    "requiredField": {
      "location": "query",
      "type": "array"
    }
  },
  "response": "array",
  "range": [
    "startDate",
    "endDate"
  ],
  "maxDays": 366
});
