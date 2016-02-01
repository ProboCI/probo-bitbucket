'use strict';

var util = require('util');
var url = require('url');
var bunyan = require('bunyan');
var Promise = require('bluebird');

/**
 * Coordinator API client that bypasses the coordinator and uses the container manager and provider handler directly.
 * @class
 *
 * @param {Object} config - Settings for the API calls
 *    {string} .url - URL for the coordinator, including protocol, host, port
 *    {string} .log - bunyan log instance to use (child will be created and used). If not supplied, a new instance will be created
 *    {string} .protocol - If {@link config.url} is not supplied, protocol for coordinator
 *    {string} .host - If {@link config.url} is not supplied, host for coordinator
 *    {string} .port - If {@link config.url} is not supplied, port for coordinator
 */
var API = function(config) {
  if (config.host) {
    config.url = url.format({
      host: config.host,
      port: config.port,
      protocol: config.protocol,
    });
  }

  this.server = {
    url: config.url,
  };

  this.token = config.token;

  if (config.log) {
    this.log = config.log.child({component: 'api-client'});
  }
  else {
    this.log = bunyan.createLogger({name: 'api-client', level: 'debug'});
  }

  this.config = config;

  this.log.info({server: this.server}, 'CM Coordinator API instantiated');
};

/**
 * @param {Object} config - See {@link API} and {@link CMAPI}
 * @return {Object} - An instance of {@link API} or {@link CMAPI} depending on whether .token is passed in as well.
 *    If config.token exists, an instance of {@link CMAPI} is returned
 */
API.getAPI = function(config) {
  var Cls = config.token ? API : require('./cm_api');

  return new Cls(config);
};

API.prototype._http = function(path, method) {
  var fullUrl = util.format('%s%s', this.server.url, path);
  var authorization = util.format('Bearer %s', this.token);
  var requestMethod = (method || 'GET').toLowerCase();
  var request = require('superagent');

  return request[requestMethod](fullUrl).set('Authorization', authorization);
};

/**
 * Submits build to the API server to be run
 * @param {Object} build - An build object to pass along to the callback to submit a build.
 * @param {Object} project- An project object to pass along to the callback to submit a build.
 * @param {function} cb - A callback to perform once the build is submitted.
 */
API.prototype.submitBuild = function(build, project, cb) {
  var body = {build: build, project: project};
  this._http('/startbuild', 'post')
    .send(body)
    .end(function(err, res) {
      if (err) return cb(err, res.body);

      var build = res.body;
      cb(null, build);
    });
};

/**
 * Pretty processes the status update.
 * Tranlsates the optional status.action into an icon in the description
 * @param {Object} status - A hash with the following properties:
 *    {string} .action - Either running, pending, or finished.
 *    {string} .description - A description of the status to post.
 * @return {string} - A properly formatted string suitable for posting.
 */
API.prototype.formatStatus = function(status) {
  var icons = {running: '▶', pending: '⌛', finished: '■'};
  var icon = icons[status.action];

  if (icon) {
    status.description = `[${icon}] ${status.description}`;
  }

  // we no longer need the .action field
  delete status.action;

  return status;
};


/**
 * Sets or updates the build status by build id and context
 * @param {Object} build - A hash with the following property:
 *    .id - The uuid of the build.
 * @param {Object} context - Context information about the method that called this one.
 * @param {Object} status - A hash with the following properties:
 *    {string} .action - Either running, pending, or finished.
 *    {string} .description - A description of the status to post.
 * @param {function} cb - The callback to pass the status to.
 */
API.prototype.setBuildStatus = function(build, context, status, cb) {
  status = this.formatStatus(status);

  // allow contexts with a slash in it, which need to be encoded to not break routing
  context = require('querystring').escape(context);

  var self = this;
  this._http('/builds/' + build.id + '/status/' + context, 'post')
    .send(status)
    .end(function(err, res) {
      if (err) {
        self.log.error({err: err, buildId: build.id}, 'An error occurred updating build status');
        return cb && cb(err);
      }

      var updatedStatus = res.body;
      self.log.info({status: updatedStatus}, 'Build status updated for build', build.id);

      if (cb) cb(null, status);
    });
};

/**
 * Looks up project by provider slug and repo slug.
 * @param {Object} request - An object with the following properties:
 *    .service - A service that the request is for (should be 'bitbucket').
 *    .slug - The slug of the repo to find the project for (such as 'proboci/zivtech' or 'dzinkevich/bitbucket-rest').
 * @param {function} cb - A function to have the coordinator pass the project to.
 */
API.prototype.findProjectByRepo = function(request, cb) {
  this._http('/projects')
    .query({
      service: request.service,
      slug: request.slug,
      single: true,
    })
    .end(function(err, res) {
      cb(err, !err && res.body);
    });
};

Promise.promisifyAll(API.prototype);

module.exports = API;
