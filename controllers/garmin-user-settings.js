'use strict';

const { garminEndpoint } = require('../helpers/garmin-endpoint');

// Retrieve the user profile settings.
module.exports = garminEndpoint({
  "path": "/userprofile-service/userprofile/settings",
  "response": "object"
});
