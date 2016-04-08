'use strict';

var restify = require('restify');
var bunyan = require('bunyan');
var yaml = require('js-yaml');
var async = require('async');

var createWebhookHandler = require('./bitbucketWebhookHandler');

var Bitbucket = require('./bitbucket');


var API = require('./api');

/**
 * Create a queue that only processes one task at a time.
 * A task is simply a function that takes a callback when it's done
 */
var statusUpdateQueue = async.queue(function worker(fn, cb) {
  fn(cb);
}, 1);


var BitbucketHandler = function(options) {
  this.options = options;

  this.validateOptions();

  // Bind functions to ensure `this` works for use in callbacks.
  this.start = this.start.bind(this);
  this.fetchProboYamlConfigFromBitbucket = this.fetchProboYamlConfigFromBitbucket.bind(this);
  this.errorHandler = this.errorHandler.bind(this);
  this.pullRequestHandler = this.pullRequestHandler.bind(this);
  this.pushHandler = this.pushHandler.bind(this);
  this.getBitbucketApi = this.getBitbucketApi.bind(this);
  this.authLookupController = this.authLookupController.bind(this);

  // Instantiate a logger instance.
  var log = bunyan.createLogger({name: 'bitbucket-handler',
                                  level: options.log_level || 'debug',
                                  src: true,
                                  serializers: {
                                    err: bunyan.stdSerializers.err,
                                    req: bunyan.stdSerializers.req,
                                  }});

  log.info({config: options}, 'BitbucketHandler loaded with config');

  var handlerOptions = {
    path: options.bbWebhookUrl,
  };

  var handler = createWebhookHandler(handlerOptions);
  handler.on('error', this.errorHandler);
  handler.on('pullrequest:created', this.pullRequestHandler);
  handler.on('pullrequest:updated', this.pullRequestHandler);
  handler.on('repo:push', this.pushHandler);

  var self = this;

  var server = options.server;


  // verbatim
  if (!server) {
    server = restify.createServer({log: log, name: 'Probo Bitbucket'});

    // set up request logging
    server.use(restify.queryParser({mapParams: false}));

    server.use(function(req, res, next) {
      req.log.info({req: req}, 'REQUEST');
      next();
    });
    server.on('after', restify.auditLogger({
      log: log,
    }));

    server.on('uncaughtException', function(request, response, route, error) {
      self.server.log.error({err: error, route: route}, 'Uncaught Exception');
      response.send(error);
    });
  }


  // verbatim
  server.post(handlerOptions.path, restify.bodyParser(), function(req, res, next) {
    handler(req, res, function(error) {
      if (error) {
        res.send(400, 'Error processing hook');
        log.error({err: error}, 'Error processing hook');
      }

      next();
    });
  });


  var buildStatusController = function(req, res, next) {
    var payload = req.body;

    if (req.params.context) {
      // usually, context will already be part of update, but read it from URL
      // if it's there for compatability
      payload.update.context = req.params.context;
    }

    log.debug({payload: payload}, 'Update payload');

    self.buildStatusUpdateHandler(payload.update, payload.build, function(err, status) {
      if (err) {
        res.json(400, {error: err.message});
      }
      else {
        res.send(status);
      }
      return next();
    });
  };

  server.post('/builds/:bid/status/:context', restify.jsonBodyParser(), buildStatusController);
  server.post('/update', restify.jsonBodyParser(), buildStatusController);

  server.get('/auth_lookup', this.authLookupController);

  this.server = server;
  this.log = log;

  this.api = API.getAPI({
    url: this.options.api.url,
    token: this.options.api.token,
    log: this.log,
    // {url, [host|hostname], [protocol], [port]}
    handler: this.options,
  });

  if (!(this.api instanceof API)) {
    log.info('api.token not found, using Container Manager API directly');
  }
};

BitbucketHandler.prototype.validateOptions = function() {
  var required = ['bbWebhookUrl', 'bbClientKey', 'bbClientSecret'];
  this._validate(this.options, required);
};

BitbucketHandler.prototype._validate = function(obj, required, msg) {
  msg = msg || 'Missing required Bitbucket config: ';

  for (var r in required) {
    if (!obj[required[r]]) {
      throw new Error(msg + required[r]);
    }
  }
};


/**
 * Starts the server listening on the configured port.
 * @param {function} cb - A callback to run once the handler has begun.
 */
BitbucketHandler.prototype.start = function(cb) {
  var self = this;
  this.server.listen(self.options.port, self.options.hostname || '0.0.0.0', function() {
    self.log.info('Now listening on', self.server.url);
    if (cb) cb();
  });
};

BitbucketHandler.prototype.stop = function(cb) {
  var self = this;
  var url = this.server.url;
  this.server.close(function() {
    self.log.info('Stopped', url);
    if (cb) cb();
  });
};

/**
 * Build options for Bitbucket api HTTP requests.
 * @param {Object} project - The project object to build an api from.
 * @return {Object} A new Bitbucket API object.
 */
BitbucketHandler.prototype.getBitbucketApi = function(project) {
  var bitbucket = new Bitbucket({
    log: this.log,
    version: '2.0',
    auth: {
      token: project.service_auth.token,
      refreshToken: project.service_auth.refreshToken,
      consumerKey: this.options.bbClientKey,
      consumerSecret: this.options.bbClientSecret,
    },
  });

  return bitbucket;
};

/**
 * Error handler for Bitbucket webhooks.
 * @param {Object} error - The object error to handle.
 */
BitbucketHandler.prototype.errorHandler = function(error) {
  this.log.error({err: error}, 'An error occurred.');
};


BitbucketHandler.prototype.pushHandler = function(event, cb) {
  this.log.info(`Bitbucket push request for ${event.payload.repository.full_name} received, ignoring.`);
  if (cb) cb();
};

/**
 * Pull Request update handler
 * @param {Object} event - The object to parse.
 * @param {function} cb - The callback for after the build is completed.
 */
BitbucketHandler.prototype.pullRequestHandler = function(event, cb) {
  // enqueue the event to be processed...
  var self = this;

  this.log.info('Bitbucket push request ' + event.payload.pullrequest.id +
                ' for ' + event.payload.repository.full_name + ' received.');

  this.log.debug({event: event}, 'Bitbucket push received');

  var pr = event.payload.pullrequest;
  var repoHtmlUrl = pr.source.repository.links.html.href;
  var request = {
    type: pr.type,
    service: 'bitbucket',
    branch: pr.source.branch.name,
    branch_html_url: repoHtmlUrl + '/branch/' + pr.source.branch.name,
    owner: event.payload.repository.owner.username,
    repo: event.payload.repository.name,
    repo_id: event.payload.repository.uuid,
    slug: event.payload.repository.full_name,
    sha: pr.source.commit.hash,
    commit_url: repoHtmlUrl + '/commits/' + pr.source.commit.hash,
    pull_request: pr.id,
    pull_request_id: event.hookId,
    pull_request_name: pr.title,
    pull_request_description: pr.description,
    pull_request_html_url: pr.links.html.href,
    payload: event.payload,
    host: event.host,
  };

  /**
   * build comes back with an embedded .project
   * not necessary to do anything here, build status updates will come asyncronously
   */
  this.processRequest(request, function(error, build) {
    self.log.info({type: request.type, slug: request.slug, err: error}, 'request processed');
    if (cb) cb(error, build);
  });
};

/**
 * Called when an build status updates
 *
 * @param {Object} update - An object with settings for the update:
 * @param {string} update.state - The status of the build.
 * @param {string} update.description - The text of the status update.
 * @param {string} update.key - Context string returned from bitbucket.
 * @param {string} update.target_url - The target url.
 * @param {Object} build - The build object, including:
 * @param {Object} build.id - Build id.
 * @param {Object} build.project - See postStatusToBitbucket prototype.
 * @param {Object} build.project.slug - See postStatusToBitbucket prototype.
 * @param {Object} build.commit.ref - An object that contains at least .ref, which is the sha for the build.
 * @param {function} cb - The callback to run after the build status is posted.
 */
BitbucketHandler.prototype.buildStatusUpdateHandler = function(update, build, cb) {
  var self = this;
  self.log.info({update: update, build_id: build.id}, 'Got build status update');

  // maps github-like statuses to ones that bitbucket accepts
  var stateMap = {
    success: 'SUCCESSFUL',
    pending: 'INPROGRESS',
    error: 'FAILED',
    fail: 'FAILED',
  };
  var updateName = (update.task && update.task.name) ? update.task.name : update.context;
  var statusInfo = {
    state: stateMap[update.state],
    description: update.description,
    // Bitbucket requires this limimted to 40 chars
    key: updateName.substring(0, 40),
    url: update.target_url,
    // 'name' will be used in place of key if provided.
    //    name: 'name ???',
  };

  // handle bad state
  if (!statusInfo.state) {
    statusInfo.state = 'PENDING';
    statusInfo.description = (statusInfo.description || '') + ' (original state:' + update.state + ')';
  }

  var task = this.postStatusToBitbucket.bind(this, build.project, build.commit.ref, statusInfo);
  statusUpdateQueue.push(task, function(error) {
    if (error) {
      self.log.error({err: error, build_id: build.id}, 'An error occurred posting status to Bitbucket');
      return cb(error, statusInfo);
    }

    self.log.info(statusInfo, 'Posted status to Bitbucket for', build.project.slug, build.commit.ref);
    cb(null, statusInfo);
  });
};

/**
 * Processes a request for a new build.
 * @param {Object} request - An object with the following props:
 * @param {string} request.type - The type of request, such as 'pullrequest:created'.
 * @param {string} request.service - The provider; should be 'bitbucket'.
 * @param {string} request.slug - The slug of the repo such as 'dzinkevich/cool-project'
 * @param {Object} request.event - The payload of the event. It is parsed here.
 * @param {function} cb - The callback to run after a build is submitted.
 */
BitbucketHandler.prototype.processRequest = function(request, cb) {
  var self = this;
  self.log.info({type: request.type, id: request.id}, 'Processing request');

  this.api.findProjectByRepo(request, function(error, project) {
    if (error || !project) {
      return self.log.warn(
        {err: error},
        'Project for bitbucket repo ' + request.slug + ' not found'
      );
    }

    self.log.info({project: project}, 'Found project for PR');

    self.fetchProboYamlConfigFromBitbucket(project, request.sha, function(error, config) {
      var build;

      if (error) {
        self.log.error({err: error}, 'Problem fetching Probo Yaml Config file');

        // If we can't find a yaml file we should error.
        build = {
          commit: {ref: request.sha},
          project: project,
        };
        var update = {
          state: 'failure',
          description: error.message,
          context: 'ProboCI/env',
        };
        return self.buildStatusUpdateHandler(update, build, cb);
      }

      self.log.info({config: config}, 'Probo Yaml Config file');

      build = {
        commit: {
          ref: request.sha,
          htmlUrl: request.commit_url,
        },
        pullRequest: {
          number: request.pull_request + '',
          name: request.pull_request_name,
          description: request.pull_request_description,
          htmlUrl: request.pull_request_html_url,
        },
        branch: {
          name: request.branch,
          htmlUrl: request.branch_html_url,
        },
        config: config,
        request: request,
      };

      self.api.submitBuild(build, project, function(err, submittedBuild) {
        if (err) {
          // TODO: save the PR if submitting it fails (though logging it here might be ok)
          self.log.error({err: err, request: request, build: build, message: submittedBuild}, 'Problem submitting build');
          return cb && cb(err);
        }

        self.log.info({build: submittedBuild}, 'Submitted build');

        cb(null, submittedBuild);
      });

    });
  });
};

/**
 * Posts status updates to Bitbucket.
 * @param {Object} project - An object with the necessary structure needed for this.getBitbucketApi, as well as:
 * @param {string} project.repo - The name of the repo, ie 'my-cool-project'.
 * @param {string} sha - A hash representing the commit to which we should attach a status update.
 * @param {Object} statusInfo - An object with the following properties:
 * @param {string} statusInfo.state - The state of the status.
 * @param {string} statusInfo.description - The body of the status.,
 * @param {string} statusInfo.key - A name for the update (max 40 characters).
 * @param {string} statusInfo.url - The URL for the status update.
 * @param {function} done - The callback for after the status has been posted.
 */
BitbucketHandler.prototype.postStatusToBitbucket = function(project, sha, statusInfo, done) {
  var self = this;
  var bitbucket;

  try {
    bitbucket = self.getBitbucketApi(project);
  }
  catch (e) {
    return done(e);
  }

  return bitbucket.statuses.create(statusInfo, {ref: sha, slug: project.slug}, function(error, body) {
    done(error, body);
  });
};

/**
 * Fetches configuration from a .probo.yml file in the bitbucket repo.
 * @param {Object} project - The project object, with the following properties:
 * @param {string} project.repo - The repo name, ie 'my-cool-project'.
 * @param {string} project.owner - The repo owner, ie 'dzinkevich'.
 * @param {string} sha - A hash representing the commit from which to fetch .probo.yaml.
 * @param {function} done - The callback to pass the .probo.yaml into.
 */
BitbucketHandler.prototype.fetchProboYamlConfigFromBitbucket = function(project, sha, done) {
  var self = this;
  var bitbucket;

  try {
    bitbucket = this.getBitbucketApi(project);
  }
  catch (e) {
    return done(e);
  }

  return bitbucket.repos.getContent({accountName: project.owner, repositorySlug: project.repo, ref: sha, path: ''}, function(error, files) {
    if (error) return done(error);

    var regex = /^(.?probo.ya?ml|.?proviso.ya?ml)$/;
    var match = false;
    var file;
    for (file of files) {
      if (regex.test(file.path)) {
        match = true;
        break;
      }
    }
    if (!match) {
      // Should this be an error or just an empty config?
      return done(new Error('No .probo.yml file was found.'));
    }

    self.log.info('Found probo config file: ' + file.path);

    bitbucket.repos.getContent({accountName: project.owner, repositorySlug: project.repo, ref: sha, path: file.path}, function(error, content) {
      if (error) {
        self.log.error({err: error}, 'Failed to get probo config file contents');

        return done(error);
      }

      var settings = yaml.safeLoad(content.toString('utf8'));
      done(null, settings);
    });
  });
};

/**
 * Calculates OAuth1.0 authorization header value for a request
 * @param {Object} req - The request. The refresh token is stored in req.query.refreshToken.
 * @param {string} req.query.refreshToken - The refresh token to generate a new token
 * @param {Object} res - The response.
 */
BitbucketHandler.prototype.authLookupController = function(req, res, next) {
  this.log.debug({query: req.query}, `auth lookup request`);

  try {
    // validate query params
    this._validate(req.query, ['refreshToken'], 'Missing required query param: ');

    // build a minimum project object
    var project = {
      service_auth: {
        refreshToken: req.query.refreshToken,
      },
    };

    var bitbucket = this.getBitbucketApi(project);
    bitbucket.refreshToken(function(err, auth) {
      if (err) {
        return next(err);
      }
      res.json(auth);
      next();
    });
  }
  catch (e) {
    this.log.error({err: e}, 'Problem getting auth header: ' + e.message);
    res.send(400, {error: e.message});
    next();
  }
};

module.exports = BitbucketHandler;
