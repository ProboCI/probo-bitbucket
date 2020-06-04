'use strict';

const async = require('async');
const bunyan = require('bunyan');
const restify = require('restify');

const API = require('./api');
const Bitbucket = require('./Bitbucket');
const WebhookHandler = require('./BitbucketWebhook');

/**
 * Create a queue that only processes one task at a time.
 * A task is simply a function that takes a callback when it's done
 */
let statusUpdateQueue = async.queue(function worker(fn, cb) {
  fn(cb);
}, 1);

class BitbucketHandler {

  constructor(config) {

    this.config = config;
    this.validateConfig();

    // Instantiate a logger instance.
    this.logger = bunyan.createLogger({
      name: 'bitbucket-handler',
      level: this.config.log_level || 'debug',
      src: true,
      serializers: {
        err: bunyan.stdSerializers.err,
        req: bunyan.stdSerializers.req,
      },
    });

    this.bitbucket = new Bitbucket(this.config, this.logger);

    this.webhookOptions = {
      path: this.config.bbWebhookUrl,
    };

    // Sets up the path and webhooks for the Bitbucket.
    this.handler = this._createWebhookHandler();

    this.server = restify.createServer({log: this.logger, name: 'Probo Bitbucket'});

    // Set ups the server and routes for the Probo Bitbucket Handler.
    this._setupServer();
    this._setupRoutes();

    this.api = API.getAPI({
      url: this.config.api.url,
      token: this.config.api.token,
      log: this.logger,
      // {url, [host|hostname], [protocol], [port]}
      handler: this.config,
    });

    if (!(this.api instanceof API)) {
      this.logger.info('api.token not found, using Container Manager API directly');
    }
  }

  /**
   * Starts the server.
   *
   * @param {function} cb - The callback function
   */
  start(cb) {
    this.server.listen({port: this.config.port, host: this.config.hostname || '0.0.0.0'}, () => {
      this.logger.info('Now listening on', this.server.url);

      if (cb) cb();
    });
  }

  /**
   * Closes the server.
   *
   * @param {function} cb - The callback function
   */
  close(cb) {
    const url = this.server.url;
    this.server.close(() => {
      this.logger.info('Stopped', url);

      if (cb) cb();
    });
  }

  /**
   * Creates a GitLab Webhook Handler.
   *
   * @return {object} - An initialized webhook handler server.
   */
  _createWebhookHandler() {
    let handler = new WebhookHandler(this.webhookOptions);

    handler.on('error', error => {
      this.logger.error({err: error}, 'An error occurred.');
    });

    handler.on('pullrequest:created', this.pullRequestHandler.bind(this));
    handler.on('pullrequest:updated', this.pullRequestHandler.bind(this));
    handler.on('repo:push', this.pushHandler.bind(this));

    return handler;
  }

  /**
   * Sets up the server for the Probo Bitbucket Handler.
   */
  _setupServer() {
    // set up request logging
    this.server.use(restify.plugins.queryParser({mapParams: false}));

    this.server.use((req, res, next) => {
      this.logger.info({req: req}, 'REQUEST');
      next();
    });

    this.server.on('after', restify.plugins.auditLogger({
      log: this.logger,
      event: 'after'
    }));

    this.server.on('uncaughtException', (_, response, route, error) => {
      this.logger.error({err: error, route: route}, 'Uncaught Exception');
      response.send(error);
    });
  }

  /**
   * Sets up the routes for the Probo GitLab Handler.
   *
   * These routes corresponds to the webhook handler and the status update
   * paths.
   */
  _setupRoutes() {

    this.server.post(this.webhookOptions.path, restify.plugins.bodyParser(), (req, res, next) => {
      this.handler.handle(req, res, error => {
        if (error) {
          res.send(400, 'Error processing hook');
          this.logger.error({err: error}, 'Error processing hook');
        }

        next();
      });
    });

    this.server.post('/builds/:bid/status/:context', restify.plugins.jsonBodyParser(), this.buildStatusController.bind(this));
    this.server.post('/update', restify.plugins.jsonBodyParser(), this.buildStatusController.bind(this));
    this.server.post('/builds/hash', restify.plugins.jsonBodyParser(), this.hashBuildController.bind(this));

    this.server.get('/pull-request/:owner/:repo/:pullRequestNumber', this.getPullRequest.bind(this));
    this.server.get('/auth_lookup', this.authLookupController.bind(this));
  }

  /**
   * Called when user wants to create a build based on a commit hash.
   *
   * This controller gets info about the commit and submits a build request.
   *
   * @param {import('restify').Request} req - The request to the server.
   * @param {import('restify').Response} res - The server response
   * @param {import('restify').Next} next - Next handler in the chain.
   */
  hashBuildController(req, res, next) {

    this.logger.info({
      owner: req.body.project.owner,
      repo: req.body.project.repo,
      sha: req.body.sha,
    }, 'Processing build for commit hash');

    const project = req.body.project;
    const sha = req.body.sha;

    // The commit info is used to fill some info about the build when sending
    // a build request to coordinator.
    this.bitbucket.getCommit(project, sha, (err, commit) => {
      if (err) {
        this.logger.error({err: err}, 'Problem getting commit info.');
        res.send(500, {error: err});

        return next();
      }

      this.handleHashBuild(commit, project, sha, (err, build) => {
        if (err) {
          this.logger.error({err: err}, 'Problem processing build for commit hash.');
          res.send(500, {error: err});

          return next();
        }

        res.json(build);
        return next();
      });
    });

  }

  /**
   * Fetches the yaml configuration and submits build request.
   *
   * @param {Object.<string, string>} commit - The info on the commit.
   * @param {Object.<string, any>} project - The project object.
   * @param {string} sha - The hash of the commit to retrieve.
   * @param {(error: Error, [build]: Object.<string, any>)} cb - The callback
   *   function.
   */
  handleHashBuild(commit, project, sha, cb) {
    this.bitbucket.fetchProboYamlConfig(project, sha, (error, config) => {
      if (error) {
        this.logger.error({err: error}, 'Problem fetching Probo Yaml Config file');

        return cb(error);
      }

      const request = {
        sha: commit.hash,
        commit_url: commit.html_url,
        name: commit.message,
        type: 'hash',
      };

      this.submitBuild(request, project, config, cb);
    });
  }

  /**
   * Called on a build status update event.
   *
   * @param {object} req - The request to the server.
   * @param {object} res - The server response
   * @param {object} next - The chain of handlers for the request.
   */
  buildStatusController(req, res, next) {
    const payload = req.body;
    req.log.info({payload: payload}, 'REQUEST');

    if (req.params.context) {
      // usually, context will already be part of update, but read it from URL
      // if it's there for compatability
      payload.update.context = req.params.context;
    }

    this.logger.debug({payload: payload}, 'Update payload');

    this.buildStatusUpdateHandler(payload.update, payload.build, (err, status) => {
      if (err) {
        res.send(500, {error: err});
      }
      else {
        res.send(status);
      }

      return next();
    });
  }

  /**
   * The handler for merge request events from Bitbucket webhooks.
   *
   * @param {object} event - The webhook event object.
   * @param {function} cb - The callback function.
   */
  pullRequestHandler(event, cb) {
    this.logger.info('Bitbucket Pull request ' + event.payload.pullrequest.id +
                  ' for ' + event.payload.repository.full_name + ' received.');

    this.logger.debug({event: event}, 'Bitbucket push received');

    let pr = event.payload.pullrequest;
    let repoHtmlUrl = pr.source.repository.links.html.href;
    let request = {
      type: 'pull_request',
      name: pr.title,
      service: 'bitbucket',
      branch: {
        name: pr.source.branch.name,
        html_url: `${repoHtmlUrl}/branch/${pr.source.branch.name}`,
      },
      pull_request: {
        number: pr.id,
        id: event.hookId,
        name: pr.title,
        description: pr.description,
        html_url: pr.links.html.href,
      },
      slug: event.payload.repository.full_name,
      owner: event.payload.repository.owner.username || event.payload.repository.full_name.split('/')[0],
      repo: event.payload.repository.name,
      repo_id: event.payload.repository.uuid,
      sha: pr.source.commit.hash,
      commit_url: `${repoHtmlUrl}/commits/${pr.source.commit.hash}`,
      payload: event.payload,
      host: event.host,
    };

    // Build comes back with an embedded .project key.
    // It's not necessary to do anything here, build status updates will come asyncronously.
    this.processWebhookEvent(request, (error, build) => {
      this.logger.info({type: request.type, slug: request.slug, err: error}, 'request processed');
      if (cb) cb(error, build);
    });
  }

  /**
   * The handler for push events from GitHub webhooks.
   *
   * @param {Object.<string, any>} event - The push event.
   * @param {(err: Error, [build]) => void} cb cb - The callback to be called
   *   after the update is performed.
   */
  pushHandler(event, cb) {
    this.logger.info('Bitbucket push event received');

    const payload = event.payload;
    const push = payload.push.changes[0];
    const type = push.new.type;

    // Don't build tags.
    if (type === 'tag') return;

    const request = {
      type: 'branch',
      name: `Branch ${push.new.name}`,
      service: 'bitbucket',
      branch: {
        name: push.new.name,
        html_url: push.new.links.html.href,
      },
      slug: payload.repository.full_name,
      owner: payload.repository.owner.username || payload.repository.full_name.split('/')[0],
      repo: payload.repository.name,
      repo_id: payload.repository.uuid,
      sha: push.new.target.hash,
      commit_url: push.new.target.links.html.href,
    };

    this.processWebhookEvent(request, (error, build) => {
      this.logger.info({type: request.type, slug: request.slug, err: error}, 'Push event processed');

      return cb && cb(error, build);
    });
  }

  /**
   * Called when an build status updates
   *
   * @param {Object} update - The update object.
   * @param {String} update.state - "status of build",
   * @param {String} update.description - The textual context to provide in the BitBucket UI. ,
   * @param {String} update.key - The name of the task, called `context` in github.
   * @param {String} update.url - The url to link to - `target_url` for github.
   * @param {Object} build - The build object for which the status is being updated.
   * @param {Object} build.project - The build object has the project embedded inside it.
   * @param {Function} cb - The callback to call once the status has been updated.
   */
  buildStatusUpdateHandler(update, build, cb) {
    this.logger.info({update: update, build_id: build.id}, 'Got build status update');

    // maps github-like statuses to ones that bitbucket accepts
    // https://developer.atlassian.com/bitbucket/api/2/reference/resource/repositories/%7Busername%7D/%7Brepo_slug%7D/commit/%7Bnode%7D/statuses/build
    let stateMap = {
      success: 'SUCCESSFUL',
      pending: 'INPROGRESS',
      error: 'FAILED',
      fail: 'FAILED',
      running: 'INPROGRESS',
    };
    let statusInfo = {
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
      statusInfo.state = 'STOPPED';
      statusInfo.description = (statusInfo.description || '') + ' (original state:' + update.state + ')';
    }

    const task = this.bitbucket.postStatus.bind(this.bitbucket, build.project, build.commit.ref, statusInfo);
    statusUpdateQueue.push(task, error => {
      if (error) {
        this.logger.error({err: error, build_id: build.id}, 'An error occurred posting status to Bitbucket');
        return cb(error, statusInfo);
      }

      this.logger.info(statusInfo, 'Posted status to Bitbucket for', build.project.slug, build.commit.ref);
      cb(null, statusInfo);
    });
  }

  /**
   * Processes a webhook event and submits a Probo build.
   *
   * @param {Object.<string, any>} request - The incoming hook request data.
   * @param {string} request.type - The type of request to process (eg
   *   pull_request).
   * @param {string} request.slug - The identifier for the repo.
   * @param {(err: Error, [build]) => void} cb - The callback to call when
   *   finished.
   */
  processWebhookEvent(request, cb) {
    this.logger.info({type: request.type, id: request.id}, 'Processing request');

    this.api.findProjectByRepo(request, (error, project) => {
      if (error || !project) {
        this.logger.info({error}, `Project for Bitbucket repo ${request.slug} not found`);
        return cb(error || new Error('Project not found'));
      }

      /** For some reason in the open source model, project.owner isn't set and we need to get it */
      /** from the project.id attribute. We will set this conditionally only if there is no project */
      /** owner. */
      if (!project.owner) {
        if (project.id) {
          var owner =  project.id.split("-");
          project.owner = owner[0];
        }
      }

      // If push event is for a branch and the branch is not enabled, do not
      // build.
      if (request.type === 'branch') {
        if (!project.branches || !project.branches[request.branch.name]) {
          return cb(null, null);
        }
      }

      this.processBuild(project, request, cb);
    });
  }

  /**
   * Process a build request for a project.
   *
   * @param {Object.<string, any>} project - The project object.
   * @param {Object.<string, any>} request - The incoming hook request data.
   * @param {(err: Error, [build]) => void} cb - The callback to call when
   *   finished.
   */
  processBuild(project, request, cb) {
    this.bitbucket.fetchProboYamlConfig(project, request.sha, (error, config) => {
      var build;

      if (error) {
        this.logger.error({err: error}, 'Problem fetching Probo Yaml Config file');

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

        return this.buildStatusUpdateHandler(update, build, cb);
      }

      this.logger.info({config: config}, 'Probo Yaml Config file');

      this.submitBuild(request, project, config, cb);
    });
  }

  /**
   * Called on a get PR request. Returns a PR info.
   *
   * @param {import('restify').Request} req - The request to the server.
   * @param {import('restify').Response} res - The server response.
   * @param {import('restify').Next} next - Next handler in the chain.
   */
  getPullRequest(req, res, next) {
    var query = {
      owner: req.params.owner,
      repo: req.params.repo,
      id: req.params.pullRequestNumber,
      refreshToken: req.query.refreshToken,
    };

    this.bitbucket.getPullRequest(query)
      .then(output => {
        res.json(200, output);

        next();
      })
      .catch(err => {
        this.logger.error({err}, 'Error getting pull request');

        next();
      });
  };

  /**
   * Submits a Probo build request.
   *
   * @param {object} request - Information on the repo/branch/commit to build.
   * @param {object} project - The project to build.
   * @param {string} config - The probo YAML config file.
   * @param {function} cb - The callback to call when finished.
   */
  submitBuild(request, project, config, cb) {
    let build = {
      commit: {
        ref: request.sha,
        htmlUrl: request.commit_url,
      },
      name: request.name,
      type: request.type,
      config: config,
    };

    // If build is for a pull request or push, branch information is passed.
    if (request.branch) {
      build.branch = {
        name: request.branch.name,
        htmlUrl: request.branch.html_url,
      };
    }

    // If build is for a pull request, extra information is passed.
    if (request.pull_request) {
      build.pullRequest = {
        number: request.pull_request.number + '',
        name: request.pull_request.name,
        description: request.pull_request.description,
        htmlUrl: request.pull_request.html_url,
      };
    }

    this.api.submitBuild(build, project, (err, submittedBuild) => {
      if (err) {
        // TODO: save the PR if submitting it fails (though logging it here might be ok)
        this.logger.error({err: err, request: request, build: build, message: submittedBuild}, 'Problem submitting build');
        return cb && cb(err);
      }

      this.logger.info({build: submittedBuild}, 'Submitted build');

      cb(null, submittedBuild);
    });
  }

  /**
   * Calculates OAuth2 authorization header value for a Bitbucket API request.
   *
   * @param {object} req - The request. The refresh token is stored in req.query.refreshToken.
   * @param {string} req.query.refreshToken - The refresh token to generate a new token
   * @param {object} res - The response.
   * @param {function} next - The next middleware to run.
   */
  authLookupController(req, res, next) {
    this.logger.debug({query: req.query}, 'auth lookup request');

    try {
      // Validate query params
      this._validate(req.query, ['refreshToken'], 'Missing required query param: ');

      this.bitbucket.authLookup(req.query.refreshToken, (err, auth) => {
        if (err) {
          return next(err);
        }

        res.json(auth);
        next();
      });
    }
    catch (e) {
      this.logger.error({err: e}, 'Problem getting auth header: ' + e.message);
      res.send(400, {error: e.message});
      next();
    }
  }

  /**
   * Validates handler configuration.
   */
  validateConfig() {
    let required = ['bbWebhookUrl', 'bbClientKey', 'bbClientSecret', 'bbAccessToken', 'bbRefreshToken'];
    this._validate(this.config, required);
  }

  /**
   * Checks that required keys exist in an object.
   *
   * @param {object} obj - The object to validate.
   * @param {array} required - The required keys in the object.
   * @param {string} msg - The message to show in case required key is missing.
   */
  _validate(obj, required, msg) {
    msg = msg || 'Missing required Bitbucket config: ';

    for (let r in required) {
      if (!obj[required[r]]) {
        throw new Error(msg + required[r]);
      }
    }
  }

}

module.exports = BitbucketHandler;
