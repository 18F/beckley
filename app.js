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
	, url = require('url')
	, request = require('request')
	, fs = require('fs')
	, elasticsearch = require('elasticsearch')
	, yaml = require('js-yaml')
	, S = require('string')
	, sugar = require('sugar')
	, cheerio = require('cheerio')
	, date_format_lite = require('date-format-lite')
	;

var app = express();

// Check the env to determine whether to run as a loader.
var loader = process.env.BECKLEY_LOADER || false;

// log (re-)start
logme('info', 'init', 'Beckley (re-)started');

// http basic auth, if required in config
if (config.app.require_http_basic_auth) {
	var basic = http_auth.basic(config.app.http_basic_auth);
	app.use(http_auth.connect(basic));
}

// Connect to Elasticsearch using what's in config.js.
var client = new elasticsearch.Client({
	host: config.es.host,
});

function logme(prefix, index_name, str) {
	var now = new Date();
	Date.masks.default = 'YYYY-MM-DD hh:mm:ss';
	str = now.format() + '	' + prefix + '	' + index_name + '	' + S(str).trim().s + '\n';
	fs.appendFileSync(config.app.log, str);
}

if (! loader) {
	// API /v0:
	//
	//	/index/:index_name/reset
	//		deletes and recreates the index
	//
	//	/index/:index_name/update/:resource_name
	//		loads all docs from a single resource into the index
	//
	//	/resources/:index_name/?q=search_term
	//		returns search results from index_name

	// app.get('/v0/index/:index_name/reset', function(req, res) {
	// 	// TO DO:
	// 	// * throttle this call
	// 	// * security layer?
	// 	// * should this be a DELETE instead of a GET?
	// 	index_name = req.params.index_name;
	// 	reset_index(index_name, res);
	// });

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

	app.get('/v0/resources/:index_name', function(req, res) {

		index_name = req.params.index_name;
		q = req.query.q || '';
		size = req.query.size || 10;
		from = req.query.from || 0;

		console.log('q = ' + q + ', from = ' + from + ', size = ' + size);

		var originalURL = req.originalUrl;

		client.search(
			{
				index: index_name,
				body: {
					from: from, 
					size: size,
					query : { 
						match : { _all : q } 
					},
					highlight : { 
						fields : { content : {} }
					}
				}
			}, 
			function(error, response) {
				if (error) {
					logstr = 'Error: ' + JSON.stringify(error, null, '  ');
					logme('error', index_name, logstr);
					res.send(logstr);
				} else {
					// if (response.hits.length > 0) {
						console.log('response.hits.hits count = ' + response.hits.hits.length);
						for (i = 0; i < response.hits.hits.length; i++) {
							doc = response.hits.hits[i];
							delete doc._source.content;
							if (doc.highlight) {
								for (h = 0; h < doc.highlight.content.length; h++) {
									highlight = doc.highlight.content[h];
									highlight = strip_tags(highlight, '<em>'); // strip all EXCEPT <em></em>
									doc.highlight.content[h] = S(highlight).collapseWhitespace().decodeHTMLEntities().s;
								}
							}
						}
					// }
					logme('success', index_name, 'responded to ' + originalURL + ' with ' + response.hits.hits.length + ' hits');
					res.send(response);
				}
			}
		);
	});

	if (config.app.listen_http) {
		http.createServer(app).listen(config.app.port);
	}

	if (config.app.listen_https) {
		https.createServer(config.ssl, app).listen(config.ssl.port);
	}
} else {
	app.get('/v0/index/:index_name/add/:resource_list_name', function(req, res) {
		index_name = req.params.index_name;
		resource_list_name = req.params.resource_list_name;
		add_resources(index_name, resource_list_name, res);
		console.log("Got Request:", index_name, 'with', resource_list_name);
	});

	function reset_index(index_name, res) {

		// For now, just drop the index and re-create it

		// TO DO: Don't delete and re-create; just update the existing index.
		// Problems to solve: 
		// (1) how to update existing records without keeping unique ES doc IDs in the resource YAML
		// (2) deleting -- how do we know what to delete, unless it's indicated in the resource YAML?

		status_code = 200;

		client.indices.delete({
			index: index_name
		}, function(err, resp, status) {
			if (err) {
				console.error('STATUS = ' + status);
				console.error('ERROR deleting index: ' + err);
				logme('warning', index_name, status + ': error deleting index');
				status_code = 400;
			} else {
				logstr = 'DELETED index';
				console.log(logstr);
				logme('info', index_name, logstr);
			}

			// either way, create (or recreate) the index
			client.indices.create({
				index: index_name,
				body: {
			     "settings": {
			         "index": {
			             "analysis": {
			                 "analyzer": {
			                     "default": {
			                         "type": "snowball",
			                         "language": "English"
			                     }
			                 }
			             }
			         }
			     },						
				}
			}, function(err, resp, status) {
				if (err) {
					logstr = 'ERROR: could not re-create index';
					console.error(logstr);
					logme('error', index_name, logstr);
					status_code = 400;
				} else {
					logstr = 'New index (re-)created.';
					console.log(logstr);
					logme('info', index_name, logstr);
				}

				client.indices.putMapping({
					index: index_name,
					type: "attachment",
					body: {
						"attachment" : {
							"properties" : {
								"content" : {
									"type" : "attachment",
									"fields" : {
										"content"  : { "term_vector" : "with_positions_offsets", "store" : "yes" },
										"title"    : { "store" : "yes", "analyzer" : "english"},
										"date"     : { "store" : "yes" },
										"_name"    : { "store" : "yes" },
										"url" : { "store" : "yes" },
										"description" : { "store" : "yes" },
										"tags" : { "store" : "yes" },
										"_content_type" : { "store" : "yes" }
									}
								}
							}
						}

					}
				}, function(err, resp, status) {
					if (err) {
						logstr = 'ERROR: could not create attachment mapping';
						console.error(logstr);
						logme('error', index_name, logstr);
						status_code = 400;
					} else {
						logstr = 'Attachment mapping created';
						console.log(logstr);
						logme('info', index_name, logstr);
					}

					if (status_code == 400) {
						res.send(400, 'Could not complete reset for index ' + index_name + '; see log.');
					} else {
						res.send(200, 'Index ' + index_name + ' reset.');
					}

				});
			});
		});
	}

	function add_resources(index_name, resource_list_name, res) {

		// var local_index_name = index_name;
		status_code = 200;

		// find the resource list corresponding to this index_name
		resource_list_url = config.app.resource_origins[index_name][resource_list_name];
		console.log('For index ' + index_name + ', resource list ' + resource_list_name + ', reading from resource list url ' + resource_list_url);

		request(resource_list_url, function(err, resp, body) {

			if (!err && resp.statusCode == 200) {

				// Get document, or throw exception on error
				try {
					var resource_list = yaml.safeLoad(resp.body);
					// console.log(JSON.stringify(resource_list, null, '  '));
					console.log('got resource_list: size = ' + resource_list.length);
				} catch (e) {
					status_code = 400;
					console.log(e);
				}

				// try to load all the resources from this resource list
				// We bind index_name to the iterator to ensure resources 
				// end up in the proper index when doing a bulk load.
				async.eachLimit(resource_list, 5, index_one_resource.bind(null, index_name, resource_list_name), function(err) {
				    // if any of the saves produced an error, err would equal that error
				    if (err) {
				    	status_code = 400;
				    	logstr = 'ERROR: error while iterating through resources: ' + JSON.stringify(err, null, '  ');
					    console.log(logstr);
					    logme('error', index_name, logstr);
				    } else {
				    	console.log('DONE.');
				    	logme('success', index_name, 'added resource list ' + resource_list_name);
				    }
				});

			} else {
				logstr = 'ERROR: could not load resource list from URL ' + resource_list_url;
				console.error(logstr);
				logme('error', index_name, logstr);
				status_code = 400;
			}

			if (status_code == 400) {
				res.send(400, 'Error: could not load resource list "' + resource_list_name + '"; see log.');
			} else {
				res.send(200, 'Loading resource list "' + resource_list_name + '". See log.');
			}

		});
	}

	function index_one_resource(index_name, resource_list_name, resource, ior_callback) {

		// move "name" to "title" for consistency in response data
		if (resource.hasOwnProperty('name') && !resource.hasOwnProperty('title')) {
			resource.title = resource.name;
			resource.name.delete;
		}

		// copy type array to tags array for consistency in response data (expedient for UI)
		if (resource.hasOwnProperty('type') && !resource.hasOwnProperty('tags')) {
			resource.tags = resource.type;
		}

		// add resource list name to the resource (for debugging/analysis)
		resource.source_list = resource_list_name;

		// download the doc
		process.nextTick(function() { 
			console.log('-- index_one_resource: processing: ' + resource.title + ' to ' + index_name);
		});

		request({
			url: resource.url,
			encoding: 'base64' 
			// note: we base64-encode here, and then decode if the content is plain text
			// for all attachments; encoding later, instead, does NOT work
		}, function(err, resp, body) {

			if (!err && resp.statusCode == 200) {
				
				process.nextTick(function() { 

					content_type = resp.headers['content-type'].split(/[ ;]/)[0];
					resource.content_type = content_type;

					if (content_type.split('/')[0] == 'text') {
						// decode text from the base64-encoding we applied above
						buf = new Buffer(body, 'base64');
						body = buf.toString('utf8');
					}

					if (content_type == 'text/html') {

						// hackey special-case handling
						if (S(resource.url).contains('studentaid.ed.gov/about/data-center/school/clery-act')) {
							// limit indexing to just the section
							url_hash = url.parse(resource.url, true).hash; // e.g., #some_university
							$ = cheerio.load(body);
							body = $(url_hash).html();
						}

						// get just text from <body>, no formatting, no <head> content, etc.;
						page_body = body.removeTags('head', 'script', 'noscript').replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').stripTags();
						page_text = S(page_body).trim().collapseWhitespace().s;
						page_type = 'post';

					} else { // THIS (attachment handling) IS NOT RIGHT YET
						page_body = S(body).collapseWhitespace().s;
						// page_text = new Buffer(page_body).toString('base64'); // body;
						page_text = page_body;
						page_type = 'attachment';
					}
					
					index_one_document(index_name, resource, page_type, page_text, ior_callback);

				});
				
			} else {
				// log that the resource wasn't retrieved.
				process.nextTick(function() { 
					logstr = 'ERROR: request failed: ' + err + ' -- could not load "' + resource.title + '" from ' + resource.url + '.';
					console.error(logstr);
					logme('error', index_name, logstr);

					ior_callback();
				});
				// ior_callback(err);
			}

		});
	}

	function index_one_document(index_name, resource, page_type, page_text, ior_callback) {

		// add the content to the resource before we add it to Elasticsearch
		resource.content = page_text;

		// add one doc to the index
		client.index({
		  index: index_name,
		  type: page_type,
		  // id: 1, // auto-generate instead
		  body: resource
		}, function (error, resp) {
			if (!error) {
					ior_callback();
			} else {
				// log that the resource couldn't be loaded into ES
				process.nextTick(function() { 
					logstr = '------ client.index: ERROR: could not load "' + resource.title + '" into ES: ' + error;
					console.error(logstr);
					logme('error', index_name, logstr);
					ior_callback();
				});
			}

		});
	}

	// http://phpjs.org/functions/strip_tags/ , via http://stackoverflow.com/a/9519256/185839
	function strip_tags (input, allowed) {
	    allowed = (((allowed || "") + "").toLowerCase().match(/<[a-z][a-z0-9]*>/g) || []).join(''); // making sure the allowed arg is a string containing only tags in lowercase (<a><b><c>)
	    var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
	        commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;
	    return input.replace(commentsAndPhpTags, '').replace(tags, function ($0, $1) {
	        return allowed.indexOf('<' + $1.toLowerCase() + '>') > -1 ? $0 : '';
	    });
	}

	if (config.app.listen_http) {
		http.createServer(app).listen(config.app.port);
	}

	if (config.app.listen_https) {
		https.createServer(config.ssl, app).listen(config.ssl.port);
	}

	// Start load timer.
	console.time('resource_load');

	// Load all default resources from config.js.
	var default_origins = config.app.resource_origins;
	
	async.forEach(Object.keys(default_origins), function(index, callback) {
		var new_index_name = index;
		var new_index_resource = default_origins[index];

		async.forEach(Object.keys(new_index_resource), function(resource, callback) {
			var new_resource_list_name = resource;
	        resource_list_url = 'http://127.0.0.1:' + config.app.port + '/v0/index/' + new_index_name + '/add/' + new_resource_list_name;
			console.log('Trying to add: ' + resource_list_url);
			request(resource_list_url, function(err, resp, body) {
				if (err) {
					return console.error('upload failed:', err);
				} else {
					console.log(resp.body);
				};
			});
			callback();
		});
		callback();
	});

	// End load timer.
	console.timeEnd('resource_load');
}