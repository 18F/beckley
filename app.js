
//
// Beckley API server: 
// for various websites and initiatives that call for basic, fast search of curated content
//

var config = require('./config');

var express = require('express')
	, async = require('async')
	, http = require('http')
	, https = require('https')
	, http_auth = require('http-auth')
	, request = require('request')
	, elasticsearch = require('elasticsearch')
	, yaml = require('js-yaml')
	, cheerio = require('cheerio')
	, S = require('string')
	;

var app = express();

// http basic auth, if required in config
if (config.app.require_http_basic_auth) {
	var basic = http_auth.basic(config.app.http_basic_auth);
	app.use(http_auth.connect(basic));
}

// Connect to Elasticsearch
// 
// TO DO: 
// * configure server and port via config.es (default here = localhost:9200)
var client = new elasticsearch.Client();


// Allow cross-site queries (CORS)
app.get('*', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
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


app.get('/v0/', function(req, res) {
	res.send('Beckley APi v0');
	// TO DO: add links to documentation and repo
});

app.get('/v0/hello', function(req, res){
	res.send('Hello World');
});

app.get('/v0/index-update/:index_name', function(req, res) {
	// TO DO:
	// * throttle this call
	// * security layer?
	index_name = req.params.index_name;
	rebuild_index(index_name);
	res.send('Loaded all documents for index ' + index_name);
});


function rebuild_index(index_name) {

	// find the resource list corresponding to this index_name
	resource_url = config.app.resource_origins[index_name];
	console.log('For index ' + index_name + ', reading from resource url ' + resource_url);

	request(resource_url, function(err, resp, body) {

		if (!err && resp.statusCode == 200) {

			// Get document, or throw exception on error
			try {
			  var resource_list = yaml.safeLoad(resp.body);
			  // console.log(JSON.stringify(resource_list, null, '  '));
			  console.log('got resource_list: size = ' + resource_list.length);
			} catch (e) {
			  console.log(e);
			}

			// For now, just drop the index and re-create it

			// TO DO: Don't delete and re-create; just update the existing index.
			// Problems to solve: 
			// (1) how to update existing records without keeping unique ES doc IDs in the resource YAML
			// (2) deleting -- how do we know what to delete, unless it's indicated in the resource YAML?

			client.indices.delete({
					index: index_name
				}, function(err, resp, status) {
					if (err) {
						console.error('STATUS = ' + status);
						console.error('ERROR deleting index: ' + err);
					} else {
						console.log('DELETED index ' + index_name);
					}

					// either way, create (or recreate) the index
					client.indices.create({
						index: index_name
					}, function(err, resp, status) {
						if (err) {
							console.error('ERROR: could not re-create index');
						} else {
							console.log('New index created.');
						}
					}
					);
				}
			);

			async.each(resource_list, index_one_resource, function(err) {
			    // if any of the saves produced an error, err would equal that error
			});

		} else {
			console.error('ERROR: could not load resource list from URL ' + config.app.resource_url);
		}

	});

}

function index_one_resource(resource) {

	// download the doc
	console.log('processing "' + resource.title + '"');

	request(resource.url, function(err, resp, body) {

		if (!err && resp.statusCode == 200) {
			
			console.log('resource.title = ' + resource.title);

			// get just text from <body>, no formatting, no <head> content, etc.
			$ = cheerio.load(body);
			$('script').remove();
			$('noscript').remove();

			page_text = S($('body').text()).trim().collapseWhitespace().s;

			index_one_document(index_name, resource, page_text);
		} else {
			// log that the resource wasn't retrieved.
			console.error('ERROR: could not load page "' + resource.title + '" from the URL');
		}
	});
}


function index_one_document(index_name, resource, page_text) {

	console.log('load_one: body starts: ' + page_text.substr(0, 40));
	console.log('title = ' + resource.title + '\ndescription = ' + resource.description + '\ntags = ' + JSON.stringify(resource.tags));

	// add one doc to the index
	client.index({
	  index: index_name,
	  type: 'post',
	  // id: 1, // auto-generate instead
	  body: {
	    title: resource.title,
	    description: resource.description,
	    content: page_text,
	    tags: resource.tags
	    // date: TIMESTAMP
	  }
	}, function (error, resp) {
		if (!error) {
			console.log('loaded title "' + resource.title + '"');
		} else {
		  // log that the resource couldn't be loaded into ES
		  console.error('ERROR: could not load "' + resource.title + '" into ES: ' + error);
		}
	});

}

app.get('/v0/resources/:index_name', function(req, res) {

	index_name = req.params.index_name;
	q = req.query.q;

	console.log('q = ' + q);

	client.search({
		index: index_name,
		q: q
	}, function(error, response) {
		if (error) {
			res.send('Error: ' + JSON.stringify(error, null, '  '));
		} else {
			res.send(response);
		}
	});

});


if (config.app.listen_http) {
	http.createServer(app).listen(config.app.port);
}

if (config.app.listen_https) {
	https.createServer(config.ssl, app).listen(config.ssl.port);
}
