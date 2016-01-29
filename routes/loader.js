var logme = require('../services/logme'),
    express = require('express'),
    async = require('async'),
    url = require('url'),
    request = require('request'),
    yaml = require('js-yaml'),
    sugar = require('sugar'),
    cheerio = require('cheerio'),
    client = require('../app').client,
    config = require('../app').config,
    S = require('string'),
    app = require('../app').app;

//	/index/:index_name/reset
//		deletes and recreates the index
app.get('/v0/index/:index_name/reset', function(req, res) {
  // TO DO:
  // * throttle this call
  // * security layer?
  // * should this be a DELETE instead of a GET?
  var index_name = req.params.index_name;
  reset_index(index_name, res);
});

app.get('/v0/index/:index_name/add/:resource_list_name', function(req, res) {
  var index_name = req.params.index_name,
      resource_list_name = req.params.resource_list_name;
  add_resources(index_name, resource_list_name, res);
  console.log("Got Request:", index_name, 'with', resource_list_name);
});

app.get('/v0/add-all', function(req, res) {
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
        }
      });
      callback();
    });
    callback();
  }, function(err) {
    if (err) return res.send(500);
    return res.send(200);
  });
});

module.exports = app;

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
    var resource_list = [];
		if (!err && resp.statusCode == 200) {

			// Get document, or throw exception on error
			try {
				resource_list = yaml.safeLoad(resp.body);
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
		delete resource.name;
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

				content_type = resp.headers['content-type'];
        content_type = content_type && content_type.split(/[ ;]/)[0];
				resource.content_type = content_type;

				if (content_type && content_type.split('/')[0] == 'text') {
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
