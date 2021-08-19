var sortedObjectKeys = require('./sorted-object-keys')
module.exports = function (obj) {
  return sortedObjectKeys(obj).map(function (key) { return obj[key] })
}
