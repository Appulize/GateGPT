const path = require('path');

// The newer 1053060988 snapshot is a logged-out landing page, not the Web app.
// Keep the tested app build until a replacement passes QR + authenticated checks.
module.exports = {
  version: '2.3000.1053021455-alpha',
  sha256: '72c57c01d36875b8c9d39126c1488ccb09e189537137393e909326fdef5d3b17',
  cachePath: path.join(__dirname, 'whatsapp-web-cache')
};
