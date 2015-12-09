var config = require('../config'),
    date_format_lite = require('date-format-lite'),
    S = require('string'),
    fs = require('fs');

module.exports = function logme(prefix, index_name, str) {
	var now = new Date();
	Date.masks.default = 'YYYY-MM-DD hh:mm:ss';
	str = now.format() + '	' + prefix + '	' + index_name + '	' + S(str).trim().s + '\n';
	fs.appendFileSync(config.app.log, str);
};
