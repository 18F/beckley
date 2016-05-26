# Beckley
Beckley is a search index and API server for curated lists of resources. The technology is [Elasticsearch](http://elasticsearch.org) fronted by a simple RESTful (ish?) API implemented in nodeJS + ExpressJS.

The idea is to allow non-devs to easily create a list of URLs and related info to be included in a silo-ed search index; and to just set this up once and have a reusable server that can serve multiple, separate search indexes, as well as (NYI) allowing searches across all the indexes.

Beckley lets you create these search indexes with simple YAML files. Each resource file contains a list of URLs of the pages and/or documents you want included in the search index. In the resource file, you can also provide additional information about each URL -- e.g., title, description, tags, or any other fields you'd like to add. For example:

```
# typical URL
- url: https://18f.gsa.gov/
  title: "18F - Digital Service Delivery for the Federal Government"
  description: "18F builds effective, user-centric digital services focused on the interaction between government and the people and businesses it serves."
  tags:
  - "delivery"
  - "agile"
  - "GSA"
  - "Presidential Innovation Fellows"
  email: 18f@gsa.gov
```

The only required field in each record is "url".

When you modify a resource file, just reset (i.e., delete and re-create) the index, and re-load the resources. You can load multiple resource files into a single index.

The names and locations of your resource files are configured on the server in `config.js`; see sample entry below under "Usage".

The resource files can reside at any reachable URL -- e.g., they can be in a GitHub repo, where you get simple built-in editing and versioning.


## Install
### Install the Beckley server
* [Download and unizp Elasticsearch](http://www.elasticsearch.org/overview/elkdownloads/), but don't start the server yet.
* Add the [Mapper Attachments plugin](https://github.com/elasticsearch/elasticsearch-mapper-attachments): `bin/plugin -install elasticsearch/elasticsearch-mapper-attachments/2.0.0`
* Start the Elasticsearch server: `bin/es-start`
* [Install nodejs](http://nodejs.org/download/).
* Grab this repo and `cd` into it.
* Copy `config-sample.js` to `config.js` and edit to taste.
* Install dependencies: `npm install`
* Start the app: `forever start app.js -w -o forever-beckley.log -e forever-beckley.err`

### Install and try out the sample search page
* Follow the instructions under "Usage" below to create a new index.
* Also per the instructions below, either add the built-in test resource file to the index (see `config-sample.js`), or create your own resource file and configure `config.js` to use it.
* Check the log (by default, `./beckley.log`; also configurable in `config.js`) to make sure everything worked.
* Copy the sample search page from `/sample` into any directory where you can serve a web page.
* Enjoy searching your index. :-)

## Usage
### Creating and Populating An Index
To create or reset an index:
```
http://localhost:8000/v0/index/your-index-name/reset
```

To add resources to an index:
```
http://localhost:8000/v0/index/your-index-name/add/resource-name
```

... where resource-name is mapped to index-name in `config.js`, like so:
```
config.app.resource_origins = {
	"my-first-index" : {
		"resource-name-1" : "http://example.com/resource-list-1.yml",
		"resource-name-2" : "http://example.com/resource-list-2.yml"
	},
	"my-second-index" : {
		"resource-name-3" : "http://example.com/resource-list-3.yml"
	}
}

```

In production, you'll want to restrict access to the `/index/reset` and `/index/add` endpoints.

### Running a Query
To query an index:
```
http://localhost:8000/v0/resource/your-index-name/?q=your-search-term&size=200&from=0
```
* q = search terms. Supports [Lucene search syntax](http://lucene.apache.org/core/2_9_4/queryparsersyntax.html).
* size = number of results to return.
* from = first result to return (for paging).

At present, queries return unadulterated [Elasticsearch results](http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/_the_search_api.html).

## 18F and cloud.gov usage
The following information is derived after experiencing a failure; it may not
be entirely accurate, but should be enough to get the job done.

### Warning
It may be the case that Beckley's config is _only_ available on cloud.gov.
This means that we should only be `restaging`, never pushing new code. To get
the current content of this file, use:

```sh
cf files beckley app/config.js
```

### Re-indexing

This app's functionality is split across two sets of routes (main.js and
loader.js). The latter defines routes associated with re-indexing and hence
should not be accessible to the public. As such, Beckley is split over two
cloud.gov apps, `beckley` and `beckley-loader`. The second has an extra
environment variable which triggers access to the "loader" routes but the app
is not mapped to a route (i.e. it cannot be accessed). To re-index, you will
want to map a route to the loader app, hit the appropriate url, and then
unmap:

```sh
cf map-route beckley-loader 18f.gov -n beckley-loader
curl https://beckley-loader.18f.gov/v0/add-all
cf delete-route 18f.gov -n beckley-loader
```

You may need to re-index if the recreating the Elastic Search instance (which
has become unresponsive in the past.)

## Misc
* The To-Do list is in this repo's Issues. Please contribute bug reports, feature requests, and code!
* [About James Beckley](http://www.loc.gov/about/about-the-librarian/previous-librarians-of-congress/john-james-beckley/)

### Public domain

This project is in the worldwide [public domain](LICENSE.md). As stated in [CONTRIBUTING](CONTRIBUTING.md):

> This project is in the public domain within the United States, and copyright and related rights in the work worldwide are waived through the [CC0 1.0 Universal public domain dedication](https://creativecommons.org/publicdomain/zero/1.0/).
>
> All contributions to this project will be released under the CC0 dedication. By submitting a pull request, you are agreeing to comply with this waiver of copyright interest.
