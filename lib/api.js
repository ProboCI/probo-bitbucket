'use strict';

var util = require('util');
var url = require('url');
var bunyan = require('bunyan');
var Promise = require('bluebird');
var querystring = require('querystring');

/**
 * @class
 * @classdesc Coordinator API client that bypasses the coordinator and uses the container manager and provider handler directly.
 *
 * @param {Object} config - Settings for the API calls
 * @param {string} config.url - URL for the coordinator, including protocol, host, port
 * @param {string} [config.log] - bunyan log instance to use (child will be created and used). If not supplied, a new instance will be created
 * @param {string} [config.protocol=http] - If {@link config.url} is not supplied, protocol for coordinator
 * @param {string} [config.host] - If {@link config.url} is not supplied, host for coordinator
 * @param {string} [config.port] - If {@link config.url} is not supplied, port for coordinator
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
 * Return an instance of {@link API} or {@link CMAPI} depending on whether .token is passed in as well. If config.token exists, an instance of {@link CMAPI} is returned
 * @param {Object} config - See {@link API} and {@link CMAPI}
 *
 * @static
 * @return {Cls} - An instantiated API object.
 */
API.getAPI = function(config) {
  var Cls = config.token ? API : require('./cm_api');

  return new Cls(config);
};

API.prototype._http = function(path, method) {
  var self = this;
  var fullUrl = util.format('%s%s', this.server.url, path);
  var authorization = util.format('Bearer %s', this.token);
  var requestMethod = (method || 'GET').toLowerCase();
  var request = require('superagent');

  self.log.info({requestMethod: requestMethod, fullUrl: fullUrl, authorization: authorization}, 'HTTP Request');

  return request[requestMethod](fullUrl).set('Authorization', authorization);
};

API.prototype.submitBuild = function(build, project, cb) {
  var body = {build: build, project: project};
  this._http('/startbuild', 'post')
    .send(body)
    .end(function(err, res) {
      if (err) return cb(err, res && res.body);

      var build = res.body;
      cb(null, build);
    });
};

/**
 * Pretty processes the status update.
 *
 * @param {object} status - The status object.
 * @return {String} - Tranlsates the optional status.action into an icon in the description
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
 * @param {Object} build - The build object.
 * @param {String} context - The string representing the name of the task.
 * @param {String} status - Whether the build was successful.
 * @param {Function} cb - The callback function.
 */
API.prototype.setBuildStatus = function(build, context, status, cb) {
  status = this.formatStatus(status);

  // Allow contexts with a slash in it, which need to be encoded to not break routing.
  context = querystring.escape(context);

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
 * Looks up project by provider slug ('github') and repo slug ('zanchin/testrepo')
 * Returns a project object if found.
 *
 * @param {Request} request - The request object.
 * @param {Function} cb - The callback to call when completed.
 */
/**
 * Notifies the Container Manager that a PR has been closed so it can emit
 * pr_closed events for the reaper to clean up builds, including any build that
 * is still in progress for the closed branch.
 *
 * @param {string} projectId - The project ID.
 * @param {string} branchName - The branch name associated with the PR.
 * @param {Function} cb - The callback to call when completed.
 */
API.prototype.notifyPrClosed = function(projectId, branchName, cb) {
  var self = this;
  this._http('/pr-closed', 'post')
    .send({projectId: projectId, branchName: branchName})
    .end(function(err, res) {
      if (err) {
        self.log.error({err: err, projectId: projectId, branchName: branchName}, 'Error notifying Container Manager of PR closure');
        return cb && cb(err);
      }
      cb && cb(null, res.body);
    });
};

/**
 * Persists refreshed Bitbucket OAuth tokens back to the coordinator.
 *
 * Bitbucket access tokens only last an hour, so without this the refreshed
 * token dies with the request that earned it and the next webhook starts from
 * the stale token in the database all over again. The coordinator resolves the
 * organization from the project and fans the new tokens out to every Bitbucket
 * project in that org.
 *
 * @param {Object} project - The project whose tokens were refreshed.
 * @param {string} project.id - The project id, used to resolve the organization.
 * @param {Object} tokens - The token payload returned by Bitbucket.
 * @param {string} tokens.access_token - The newly issued access token.
 * @param {string} [tokens.refresh_token] - A rotated refresh token, if one was issued.
 * @param {number} [tokens.expires_in] - Access token lifetime, in seconds.
 * @param {Function} [cb] - The callback to call when completed.
 * @return {Null} - No return value.
 */
API.prototype.updateTokens = function(project, tokens, cb) {
  var self = this;

  // Endpoints that authenticate with a bare refresh token (branches, commits,
  // pull-request, auth_lookup) have no project to persist against.
  if (!project || !project.id) {
    this.log.debug('No project id available, skipping Bitbucket token persistence');
    return cb && cb();
  }

  if (!tokens || !tokens.access_token) {
    return cb && cb(new Error('Refusing to persist an empty Bitbucket access token'));
  }

  // Bitbucket only sends refresh_token back when it rotates one, so fall back
  // to the token we already hold rather than sending an empty header.
  var refreshToken = tokens.refresh_token ||
    (project.service_auth && project.service_auth.refreshToken);

  var request = this._http('/projects/tokens', 'post')
    .set('projectid', project.id)
    .set('providertype', 'bitbucket')
    .set('token', tokens.access_token);

  if (refreshToken) {
    request.set('refreshtoken', refreshToken);
  }

  if (tokens.expires_in) {
    request.set('tokencreatedat', String(Math.floor(Date.now() / 1000)));
    request.set('tokenexpiresin', String(tokens.expires_in));
  }

  request.end(function(err, res) {
    if (err) {
      self.log.error({err: err, projectId: project.id}, 'Failed to persist refreshed Bitbucket tokens');
      return cb && cb(err);
    }

    self.log.info({projectId: project.id}, 'Persisted refreshed Bitbucket tokens to the coordinator');
    if (cb) cb(null, res.body);
  });
};

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
