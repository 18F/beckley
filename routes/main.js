var logme = require('../services/logme'),
    client = require('../app').client,
    express = require('express'),
    request = require('request'),
    S = require('string'),
    app = require('../app').app,
    config = require('../app').config;

//	/resources/:index_name/?q=search_term
//		returns search results from index_name
app.get('/v0/resources/:index_name', function(req, res) {

  var index_name = req.params.index_name,
      q = req.query.q || '',
      size = req.query.size || 10,
      from = req.query.from || 0,
      originalURL = req.originalUrl;

  console.log('q = ' + q + ', from = ' + from + ', size = ' + size);

  client.search({
    index: index_name,
    body: {
      from: from,
      size: size,
      query : { match : { _all : q } },
      highlight : { fields : { content : {} } }
    }
  }, function(error, response) {
      var logstr, doc, highlight;

      if (error) {
        logstr = 'Error: ' + JSON.stringify(error, null, '  ');
        logme('error', index_name, logstr);
        return res.send(logstr);
      }

      console.log('response.hits.hits count = ' + response.hits.hits.length);

      for (var i = 0; i < response.hits.hits.length; i++) {
        doc = response.hits.hits[i];
        delete doc._source.content;
        if (doc.highlight) {
          for (var h = 0; h < doc.highlight.content.length; h++) {
            highlight = doc.highlight.content[h];
            highlight = strip_tags(highlight, '<em>'); // strip all EXCEPT <em></em>
            doc.highlight.content[h] = S(highlight)
              .collapseWhitespace()
              .decodeHTMLEntities().s;
          }
        }
      }

      logme('success', index_name, 'responded to ' + originalURL + ' with ' + response.hits.hits.length + ' hits');

      return res.send(response);

    }
  );
});

module.exports = app;

// http://phpjs.org/functions/strip_tags/ , via http://stackoverflow.com/a/9519256/185839
function strip_tags (input, allowed) {
		allowed = (((allowed || "") + "").toLowerCase().match(/<[a-z][a-z0-9]*>/g) || []).join(''); // making sure the allowed arg is a string containing only tags in lowercase (<a><b><c>)
		var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
				commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;
		return input.replace(commentsAndPhpTags, '').replace(tags, function ($0, $1) {
				return allowed.indexOf('<' + $1.toLowerCase() + '>') > -1 ? $0 : '';
		});
}
