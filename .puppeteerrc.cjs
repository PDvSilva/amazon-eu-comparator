const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Não baixa Chrome durante instalação
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};

