
var request = require('request');
var elasticsearch = require('elasticsearch');
var yaml = require('js-yaml');
var fs = require('fs');


// Get document, or throw exception on error
try {
  var resource_list = yaml.safeLoad(fs.readFileSync('test.yml', 'utf8'));
  console.log(resource_list);
} catch (e) {
  console.log(e);
}


// Connect to localhost:9200 and use the default settings
var client = new elasticsearch.Client();


for (resource in resource_list) {

	// download the doc
	url = resource.url;

	body = request(url);
	
	// add one doc to the index
	// index a document
	client.index({
	  index: 'campus-sexual-assault-awareness',
	  type: 'post',
	  // id: 1,
	  body: {
	    title: resource.title,
	    description: resource.description,
	    content: html_stripped_content //,
	    // date: TIMESTAMP
	  }
	}, function (err, resp) {
	  // error handling
	});

	
}
