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
	, fs = require('fs')
	, elasticsearch = require('elasticsearch')
	, yaml = require('js-yaml')
	, S = require('string')
	, sugar = require('sugar')
	, date_format_lite = require('date-format-lite')
	;

var app = express();

// log (re-)start
logme('info', 'init', 'Beckley (re-)started');

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

	logme('request', '', req.originalUrl);
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

app.get('/v0/index-update/:index_name', function(req, res) {
	// TO DO:
	// * throttle this call
	// * security layer?
	index_name = req.params.index_name;
	rebuild_index(index_name);
	res.send('Rebuilding index ' + index_name + '; see log.');
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
					logme('warning', index_name, status + ': error deleting index');
				} else {
					logstr = 'DELETED index';
					console.log(logstr);
					logme('info', index_name, logstr);
				}

				// either way, create (or recreate) the index
				client.indices.create({
					index: index_name
				}, function(err, resp, status) {
					if (err) {
						logstr = 'ERROR: could not re-create index';
						console.error(logstr);
						logme('error', index_name, logstr);
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
						} else {
							logstr = 'Attachment mapping created';
							console.log(logstr);
							logme('info', index_name, logstr);
						}

						// either way, try to load all the resources
						async.eachLimit(resource_list, 5, index_one_resource, function(err) {
						    // if any of the saves produced an error, err would equal that error
						    if (err) {
						    	logstr = 'ERROR: error while iterating through resources: ' + JSON.stringify(err, null, '  ');
							    console.log(logstr);
							    logme('error', index_name, logstr);
						    } else {
						    	console.log('DONE.');
						    	logme('success', index_name, 'index-update completed');
						    }
						});

					});
				});
			});

		} else {
			logstr = 'ERROR: could not load resource list from URL ' + config.app.resource_url;
			console.error(logstr);
			logme('error', index_name, logstr);
		}

	});

}

function index_one_resource(resource, ior_callback) {

	// download the doc
	process.nextTick(function() { 
		console.log('-- index_one_resource: processing "' + resource.title + '"');
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


// http://phpjs.org/functions/strip_tags/ , via http://stackoverflow.com/a/9519256/185839
function strip_tags (input, allowed) {
    allowed = (((allowed || "") + "").toLowerCase().match(/<[a-z][a-z0-9]*>/g) || []).join(''); // making sure the allowed arg is a string containing only tags in lowercase (<a><b><c>)
    var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
        commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;
    return input.replace(commentsAndPhpTags, '').replace(tags, function ($0, $1) {
        return allowed.indexOf('<' + $1.toLowerCase() + '>') > -1 ? $0 : '';
    });
}


function logme(prefix, index_name, str) {
	var now = new Date();
	Date.masks.default = 'YYYY-MM-DD hh:mm:ss';
	str = now.format() + '	' + prefix + '	' + index_name + '	' + S(str).trim().s + '\n';
	fs.appendFileSync(config.app.log, str);
}



if (config.app.listen_http) {
	http.createServer(app).listen(config.app.port);
}

if (config.app.listen_https) {
	https.createServer(config.ssl, app).listen(config.ssl.port);
}
