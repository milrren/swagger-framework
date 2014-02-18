'use strict';

/**
 * Module dependencies.
 */

var http = require('http');
var lodash = require('lodash');
var middleware = require('./middleware');
var parseUrl = require('url').parse;
var routington = require('routington');

/**
 * Initialize a new `FrameworkRouter`.
 *
 * @param {Framework} framework
 * @api private
 */

function FrameworkRouter(framework) {
  this.framework = framework;
}

/**
 * Build routes
 *
 * @api private
 */

FrameworkRouter.prototype.build = function(trie) {
  var framework = this.framework;

  lodash.forOwn(framework.apis, function(api) {
    lodash.forOwn(api.resources, function(resource) {

      // convert swagger path to routington
      var path = resource.path;
      path = path.replace('{format}', 'json');
      path = path.replace(/\{(\w+)\}/g, function(src, dst) {
        return ':' + dst;
      });

      // define resource path
      var node = trie.define(path)[0];

      node.methods = {};

      // add resource methods to trie
      lodash.forOwn(resource.operations, function(operation, method) {
        var stack = [];

        stack.push(middleware.header(operation));
        stack.push(middleware.path(operation));
        stack.push(middleware.query(operation));
        stack.push(middleware.authenticate(operation));
        stack.push(middleware.body(operation));

        stack.push(resource.operations[method].fn);

        // filter non-functions
        stack = stack.filter(function(fn) {
          return typeof fn === 'function';
        });

        node.methods[method] = stack;
      });

      node.handle = function(req, res) {
        var stack = node.methods[req.method];

        if (!stack && req.method === 'HEAD') {
          stack = node.methods.GET;
        }

        if (!stack) return res.reply(405);

        var i = 0;
        (function next(err) {
          if (err) return req.reply(500, err);
          var fn = stack[i++];
          if (fn) fn(req, res, next);
        })();
      };
    });
  });

  return trie;
};

/**
 * Dispatch and handle requests
 *
 * @api private
 */

FrameworkRouter.prototype.dispatcher = function() {
  // create trie
  var trie = this.build(routington());

  // dispatch request
  return function(req, res) {
    // swagger object
    req.swagger = res.swagger = {
      url: parseUrl(req.url, true),
    };

    var match = trie.match(req.swagger.url.pathname);

    // normalized reply
    res.reply = function(code, data) {
      res.statusCode = code;
      if (!data) data = { message: http.STATUS_CODES[code] };
      res.end(JSON.stringify(data, null, 4) + '\n');
    };

    if (match && match.node && match.node.handle) {
      req.params = match.param;
      return match.node.handle(req, res);
    }

    return res.reply(404);
  };
};

/**
 * Expose FrameworkRouter.
 */

module.exports = FrameworkRouter;