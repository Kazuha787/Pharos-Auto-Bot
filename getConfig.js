const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

let config = null;
function getConfig() {
  const configPath = path.join(__dirname, 'config.yaml');
  config = yaml.load(fs.readFileSync(configPath, 'utf8'));
  return config;
}

module.exports = getConfig;
