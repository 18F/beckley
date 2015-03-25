// Create config.js, in this directory, based on this sample file.

// fs = require('fs');

var config = {};

// Use cfenv to parse the Cloud Foundry service config.
var cfenv = require("cfenv");
var appEnv = cfenv.getAppEnv();
uri = appEnv.getServiceURL("beckley-example-es");

config.app = {};

config.app.log = './beckley.log';

config.app.resource_origins = {
	"test" : {
		"resource-1" : "https://raw.githubusercontent.com/18F/beckley/master/test/test-resources.yml"
	}
}

config.es = {};
config.es.host = uri
config.es.base_url = uri + "_search";

// require basic authentication
config.app.require_http_basic_auth = false;
// config.app.http_basic_auth = {
// 	realm: 'beckley'
// 	, file: '/usr/local/etc/nginx/auths'
// };


// http
config.app.listen_http = true;
config.app.port = appEnv.port || 8000;

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
