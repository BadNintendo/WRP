try {
  module.exports = require('../build/Debug/wrpc.node');
} catch (error) {
  module.exports = require('../build/Release/wpr.node');
}
