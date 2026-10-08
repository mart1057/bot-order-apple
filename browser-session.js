const fs = require('fs');
const os = require('os');
const path = require('path');

// Each browser gets an empty profile, including across separate runs.
module.exports = function createBrowserSession(number) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `apple-bot-${number}-`));
};
