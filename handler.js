'use strict';

var BitbucketHandler = require('./lib/BitbucketHandler');

var exports = function() {
  this.configure = this.configure.bind(this);
  this.options = this.options.bind(this);
  this.run = this.run.bind(this);
  this.yargs = null;
};

var server = {};

exports.shortDescription = 'Runs a webhook handler and sends updates to bitbucket status API.';

exports.help = 'Usage: npm start [args]';
exports.help += '\n';
exports.help += 'Provides a bitbucket webhook endpoint.';

exports.options = function(yargs) {
  this.yargs = yargs;
  return yargs
    .describe('port', 'The port on which to listen for incoming requests.')
    .alias('port', 'p')
  ;
};

exports.configure = function(config) {
  server = new BitbucketHandler(config);
};

exports.run = function(cb) {
  server.start();
};

module.exports = exports;
