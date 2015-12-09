//
// Beckley API server:
// for various websites and initiatives that call for basic, fast search of curated content
//

var config = require('./config'),
		express = require('express'),
		http = require('http'),
		https = require('https'),
		http_auth = require('http-auth'),
		elasticsearch = require('elasticsearch'),
		logme = require('./services/logme'),
		app = express(),
		// Check the env to determine whether to run as a loader.
		loader = process.env.BECKLEY_LOADER || false;

// Connect to Elasticsearch using what's in config.js.
module.exports = {
	client: new elasticsearch.Client({
		host: config.es.host
	}),
	config: config,
	app: app
};

// log (re-)start
logme('info', 'init', 'Beckley (re-)started');

// http basic auth, if required in config
if (config.app.require_http_basic_auth) {
	var basic = http_auth.basic(config.app.http_basic_auth);
	app.use(http_auth.connect(basic));
}

// Generic routes
// Allow cross-site queries (CORS)
app.get('*', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");

  if (req.originalUrl != '/v0/ping') {
    logme('request', '', req.originalUrl);
  }
  next();
});
app.options('*', function(req, res) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Requested-With, X-Prototype-Version, Authorization',
    'Content-Type': 'application/json;charset=utf-8'
  });
  res.send('supported options: GET, OPTIONS [non-CORS]');
});
app.get('/', function(req, res) {
  res.send('Hello. Try http://api.data.gov');
});
app.get('/v0/', function(req, res) {
  res.send('Beckley APi v0');
  // TO DO: add links to documentation and repo
});
app.get('/v0/ping', function(req, res){
  res.send('pong');
});

if (config.app.listen_http) http.createServer(app).listen(config.app.port);
if (config.app.listen_https) https.createServer(config.ssl, app).listen(config.ssl.port);

// Load routes
if (loader) require('./routes/loader');
else require('./routes/main');
