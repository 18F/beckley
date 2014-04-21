// Create config.js, in this directory, based on this sample file.

// fs = require('fs');

var config = {};

config.app = {};

config.app.log = './beckley.log';

config.app.resource_origins = {
	"test" : "https://raw.githubusercontent.com/18F/beckley/master/test/test-resources.yml"
}

config.es = {};
config.es.base_url = 'http://localhost:9200/_search';

// require basic authentication
config.app.require_http_basic_auth = false;
// config.app.http_basic_auth = {
// 	realm: 'beckley'
// 	, file: '/usr/local/etc/nginx/auths'
// };


// http
config.app.listen_http = true;
config.app.port = process.env.BECKLEY_API_PORT || 8000;

// https
config.app.listen_https = false;
// config.ssl = {
// 	port: process.env.BECKLEY_API_SSL_PORT || 8001
// 	, key: fs.readFileSync('../keys/server.key').toString()
// 	, cert: fs.readFileSync('../keys/server.crt').toString()
// 	, ca: fs.readFileSync('../keys/ca.crt')
// 	, passphrase: 'fbopen'
// 	, requestCert: true
// 	, rejectUnauthorized: false
// };

module.exports = config;
