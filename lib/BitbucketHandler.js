'use strict';

var restify = require('restify');
var bunyan = require('bunyan');
var yaml = require('js-yaml');
var async = require('async');

var BitBucketHandler = require('./bitbucketWebhookHandler');

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
  var handlerOptions = {
    path: options.bbWebhookUrl,
  };

  var handler = new BitBucketHandler(handlerOptions);
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
 * update = {
 *  state: "status of build",
 *  description: "",
 *  key: "the context", // <- 'context' for github
 *  url: ""             // <- 'target_url' for github
 * }
 *
 * build has an embedded .project too
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
  var statusInfo = {
    state: stateMap[update.state],
    description: update.description,
    // Bitbucket requires this limimted to 40 chars (otherwise the API sends back an error)
    key: update.context.substring(0, 40),
    url: update.target_url,
    // 'name' will be used in place of key in the UI if provided, but the key still servers as the
    // unique update identifier.
    name: update.context,
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
 * request: {type, service, slug, event}
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
 *
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

  bitbucket.statuses.create(statusInfo, {ref: sha, slug: project.slug}, function(error, body) {
    done(error, body);
  });
};

/**
 * Fetches configuration from a .probo.yml file in the bitbucket repo.
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

  bitbucket.repos.getContent({accountName: project.owner, repositorySlug: project.repo, ref: sha, path: ''}, function(error, files) {
    if (error) return done(error);

    var i = null;
    var regex = /^(.?probo.ya?ml|.?proviso.ya?ml)$/;
    var match = false;
    var file;
    for (i in files) {
      file = files[i];
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

      // TODO: bad YAML error handling
      var settings = yaml.safeLoad(content.toString('utf8'));
      done(null, settings);
    });
  });
};

/**
 * Calculates OAuth1.0 authorization header value for a request
 * params:
 *  - type: 'bitbucket'
 *  - refreshToken: user's refresh token
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

    var self = this;
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
