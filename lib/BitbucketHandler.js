'use strict';

var util = require('util');
var restify = require('restify');
var bunyan = require('bunyan');
var yaml = require('js-yaml');


var createWebhookHandler = require('./bitbucketWebhookHandler');

var Bitbucket = require('./bitbucket');


var API = require('./api');
var CMAPI = require('./cm_api');


var BitbucketHandler = function(options) {

  this.options = options;

  this.validateOptions();

  // Bind functions to ensure `this` works for use in callbacks.
  this.start = this.start.bind(this);
  this.fetchProboYamlConfigFromBitbucket = this.fetchProboYamlConfigFromBitbucket.bind(this);
  this.errorHandler = this.errorHandler.bind(this);
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
    path: options.bitbucketWebhookPath,
    secret: options.bitbucketWebhookSecret,
  };

  var handler = createWebhookHandler(handlerOptions);
  handler.on('error', this.errorHandler);
  // handler.on('pull_request', this.pullRequestHandler);
  handler.on('push', this.pushHandler);

  var self = this;

  var server = options.server;


  // verbatim
  if (!server) {
    server = restify.createServer({log: log, name: 'Probo BitBucket'});

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
        res.send(500, {error: err});
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

  // writes to cm directly
  if (this.options.api.token) {
    this.api = new API({
      url: this.options.api.url,
      token: this.options.api.token,
      log: this.log,
    });
  }
  else {
    // use container manager directly
    log.info('api.token not found, using Container Manager API directly');
    this.api = new CMAPI({
      url: this.options.api.url,
      log: this.log,
      handler: this,
    });
  }
};

BitbucketHandler.prototype.validateOptions = function() {
  var providers = this.options.providers;
  var provider;

  var required = ['url', 'consumerKey', 'consumerSecret'];

  for (var slug in providers) {
    provider = providers[slug];

    // ignore non-Bitbucket providers
    if (provider.type !== 'bitbucket') {
      continue;
    }

    this._validate(provider, required);
  }
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
    cb && cb();
  });
};

BitbucketHandler.prototype.stop = function(cb) {
  var self = this;
  var url = this.server.url;
  this.server.close(function() {
    self.log.info('Stopped', url);
    cb && cb();
  });
};

/**
 * Build options for Bitbucket api HTTP requests.
 */
BitbucketHandler.prototype.getBitbucketApi = function(project) {
  var provider = this.options.providers[project.provider.slug];

  if (!provider) {
    throw new Error('Could not find provider for slug: ' + project.provider.slug);
  }

  var bitbucket = new Bitbucket({
    url: provider.url,
    auth: {
      type: 'oauth1',
      token: project.service_auth.token,
      tokenSecret: project.service_auth.tokenSecret,
      consumerKey: provider.consumerKey,
      consumerSecret: provider.consumerSecret,
    }
  });

  return bitbucket;
};

/**
 * Error handler for Bitbucket webhooks.
 */
BitbucketHandler.prototype.errorHandler = function(error) {
  this.log.error({err: error}, 'An error occurred.');
};


/**
 * Handler for push events.
 */
BitbucketHandler.prototype.pushHandler = function(event, cb) {
  // enqueue the event to be processed...
  var self = this;
  
  // this.log.info('Bitbucket Pull request ' + event.payload.pull_request.id + ' received');
  this.log.info('Bitbucket push received');
  this.log.debug({event: event}, 'Bitbucket push received');
  var request = {
    type: event.payload.pullrequest.type,  // 'UPDATE'
    service: 'bitbucket',      // will always be bitbucket
    owner: event.payload.repository.owner.username,
    repo: event.payload.repository.name,
    repo_id: event.payload.repository.uuid,
    branch: event.payload.pullrequest.source.branch.name, // refId: refs/heads/feature
    sha: event.payload.pullrequest.source.commit.hash,
    payload: event.payload,
    host: undefined,
    pull_request: event.payload.pullrequest.id,
    branch_html_url: event.payload.repository.links.html.href + '/branch/' + event.payload.pullrequest.source.branch.name,
    slug: event.payload.repository.full_name,
    commit_url: event.payload.pullrequest.source.commit.links.self.href,
    pull_request: event.payload.pullrequest.id,
    pull_request_id: null,
    pull_request_name: event.payload.pullrequest.title,
    pull_request_description: event.payload.pullrequest.description,
    pull_request_html_url: event.payload.pullrequest.links.html.href, //new
  };

  /**
   * build comes back with an embedded .project
   * not necessary to do anything here, build status updates will come asyncronously
   */
  this.processRequest(request, function(error, build) {
    self.log.info({type: request.type, slug: request.slug, err: error}, 'request processed');
    cb && cb(error, build);
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
    key: update.context,
    url: update.target_url,
  };

  // handle bad state
  if (!statusInfo.state) {
    statusInfo.state = 'PENDING';
    statusInfo.description = (statusInfo.description || '') + ' (original state:' + update.state + ')';
  }

  self.postStatusToBitbucket(build.project, build.ref, statusInfo, function(error) {
    if (error) {
      self.log.error({err: error, build_id: build.id}, 'An error occurred posting status to Bitbucket');
      return cb(error, statusInfo);
    }

    self.log.info(statusInfo, 'Posted status to Bitbucket for', build.project.slug, build.ref);
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

      if (error) {
        return self.log.error({err: error}, 'Problem fetching Probo Yaml Config file');
      }
      else {
        self.log.info({config: config}, 'Probo Yaml Config file');
      }

      var build = {
        commit: {
          ref: request.sha,
          html_url: request.commit_url
        },
        pullRequest: {
          number: request.pull_request + '',
          name: request.pull_request_name,
          description: request.pull_request_description,
          html_url: request.pull_request_html_url
        },
        branch: {
          name: request.branch,
          html_url: request.branch_html_url
        },
        ref: request.sha,
        config: config,
        request: request,
      };

      self.api.submitBuild(build, project, function(err, build) {
        if (err) {
          // TODO: save the PR if submitting it fails (though logging it here might be ok)
          self.log.error({err: err, request: request, // build: build
                         }, 'Problem submitting build');
          return cb && cb(err);
        }

        self.log.info({build: build}, 'Submitted build');

        cb(null, build);
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

  bitbucket.statuses.create(statusInfo, {ref: sha}, function(error, body) {
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

  bitbucket.repos.getContent({projectKey: project.owner, repositorySlug: project.repo, ref: sha, path: ''}, function(error, files) {
    if (error) return done(error);

    var i = null;
    var regex = /^(.?probo.ya?ml|.?proviso.ya?ml)$/;
    var match = false;
    var file;
    for (i in files) {
      file = files[i];
      if (regex.test(file.path.name)) {
        match = true;
        break;
      }
    }
    if (!match) {
      // Should this be an error or just an empty config?
      return done(new Error('No .probo.yml file was found.'));
    }

    bitbucket.repos.getContent({projectKey: project.owner, repositorySlug: project.repo, ref: sha, path: file.path.name}, function(error, content) {
      if (error) {
        self.log.error({error: error}, 'Failed to get probo config file contents');

        return done(error);
      }

      var settings = yaml.safeLoad(content.toString('utf8'));
      done(null, settings);
    });
  });
};

/**
 * Calculates OAuth1.0 authorization header value for a request
 * params:
 *  - type: 'bitbucket'
 *  - path: pre-build path to append to Bitbucket server URL
 *  - provider_slug: provider slug
 *  - token: user auth token
 *  - tokenSecret: user auth token secret
 */
BitbucketHandler.prototype.authLookupController = function(req, res, next) {
  this.log.debug({query: req.query}, `auth lookup request: ${req.query.provider_slug} ${req.query.path}`);

  try {
    // validate query params
    this._validate(req.query, ['path', 'provider_slug'],
                   "Missing required query param: ");

    // build a minimum project object
    var project = {
      provider: {
        slug: req.query.provider_slug,
      },
      service_auth: {
        token: req.query.token,
        tokenSecret: req.query.tokenSecret,
        refreshToken: req.query.refreshToken,
      }
    };

    var bitbucket = this.getBitbucketApi(project);
    bitbucket.getNewToken({}, function(opts, next) {
      var url = bitbucket.url + req.query.path;
      opts.uri = url;
      res.send({opts, url});
      next();
    });
  } catch (e){
    this.log.error({err: e}, "Problem getting auth header: " + e.message);

    res.send(400, {error: e.message});
    next();
  }
};

module.exports = BitbucketHandler;
