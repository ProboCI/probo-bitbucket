
const yaml = require('js-yaml');

const BitbucketApi = require('./bitbucket/BitbucketApi');

class Bitbucket {

  /**
   * Constructor.
   *
   * @param {Object.<string, any>} config - The configuration object.
   * @param {import('bunyan')} logger - The logger.
   */
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;

    /** @type import('./bitbucket/BitbucketApi') this.client */
    this.client = null;
  }

  /**
   * Builds options for GitLab API and returns a client object.
   *
   * @param {Object.<string, any>} project - A project object.
   * @return {import('./bitbucket/BitbucketApi')} - An instantiated and
   *   configured Bitbucket client object.
   */
  getApi(project) {
    if (!this.client) {

      this.client =  new BitbucketApi({
        log: this.logger,
        version: '2.0',
        auth: {
          token: project.service_auth.token,
          refreshToken: project.service_auth.refreshToken,
          consumerKey: this.config.bbClientKey,
          consumerSecret: this.config.bbClientSecret,
        },
      });
    }

    return this.client;
  }

  /**
   * Handles the OAuth2 authorization header value for a Bitbucket API request.
   *
   * @param {string} refreshToken - The refresh token to generate a new token.
   * @param {(error: Error, [auth]: Object.<string, any>) => void} cb - The
   *   callback function to call on success/failure.
   */
  authLookup(refreshToken, cb) {

    // build a minimum project object
    let project = {
      service_auth: {
        refreshToken: refreshToken
      },
    };

    let bitbucket = this.getApi(project);

    bitbucket.refreshToken(cb);
  }

  /**
   * Gets information for a commit.
   *
   * @param {Object.<string, string>} project - The project object.
   * @param {string} sha - The git commit hash to get info on.
   * @param {(err: Error, [commit]: Object.<string, string>) => void} cb - The
   *   callback function.
   */
  getCommit(project, sha, cb) {
    const bitbucket = this.getApi(project);

    const query = {
      owner: project.owner,
      repo: project.repo,
      ref: sha,
    }

    bitbucket.repos.getCommit(query, (err, res) => {
      if (err) {
        this.logger.error({err: err}, 'Failed to get commit info.');

        return cb(err);
      }

      const commit = {
        html_url: res.links.html.href,
        message: res.message,
        hash: res.hash,
      };

      cb(null, commit);
    });
  }

  /**
   * Fetches configuration from a .probo.yml file in the bitbucket repo.
   *
   * @param {Object.<string, any>} project - The project object.
   * @param {string} project.repo - The repo name, ie 'my-cool-project'.
   * @param {string} project.owner - The repo owner, ie 'dzinkevich'.
   * @param {string} sha - A hash representing the commit from which to fetch
   *   .probo.yaml.
   * @param {(error: Error, [settings]: Object.<string, any>) => void} cb - The
   *   callback to pass the .probo.yaml into.
   */
  fetchProboYamlConfig(project, sha, cb) {

    this.fetchYamlFile('.probo.yml', project, sha, (error, settings) => {

      if (!error) {
        return cb(null, settings);
      }

      this.fetchYamlFile('.probo.yaml', project, sha, (error, settings) => {
        if (error) {
          this.logger.error({err: error}, 'Failed to get probo config file contents');

          return cb(error);
        }

        cb(null, settings);
      });
    });
  }

  /**
   * Fetches a YAML file from Bitbucket repo.
   *
   * @param {string} path - The path of the file to fetch.
   * @param {Object.<string, any>} project - The project object.
   * @param {string} project.repo - The repo name, ie 'my-cool-project'.
   * @param {string} project.owner - The repo owner, ie 'dzinkevich'.
   * @param {string} sha - The git commit id to fetch the .probo.yaml from.
   * @param {(error: Error, [settings]: Object.<string, any>) => void} cb - The
   *   callback to call upon error/completion.
   */
  fetchYamlFile(path, project, sha, cb) {

    const bitbucket = this.getApi(project);

    let args = {
      accountName: project.owner,
      repositorySlug: project.repo,
      ref: sha,
      path: path
    }

    bitbucket.repos.getContent(args, (error, content) => {
      if (error) {
        return cb(error);
      }

      // TODO: bad YAML error handling
      var settings = yaml.safeLoad(content.toString('utf8'));
      cb(null, settings);
    });
  }

  /**
   * Posts status updates to Bitbucket.
   *
   * @param {Object.<string, any>} project - The project object.
   * @param {string} project.repo - The name of the repo, ie 'my-cool-project'.
   * @param {string} sha - A hash representing the commit to which we should
   *   attach a status update.
   * @param {Object.<string, string>} statusInfo - An object with the following
   *   properties:
   * @param {string} statusInfo.state - The state of the status.
   * @param {string} statusInfo.description - The body of the status.,
   * @param {string} statusInfo.key - A name for the update (max 40 characters).
   * @param {string} statusInfo.url - The URL for the status update.
   * @param {(error: Error, [status]: Object.<string, any>) => void} cb - The
   *   callback for after the status has been posted.
   */
  postStatus(project, sha, statusInfo, cb) {

    const bitbucket = this.getApi(project);

    bitbucket.statuses.create(statusInfo, {ref: sha, slug: project.slug}, (error, body) => {
      cb(error, body);
    });
  }

  /**
   * Gets information on a pull request.
   *
   * @param {Object.<string, any>} query - The parameters for the request.
   * @param {string} query.owner - The GitHub repo owner.
   * @param {string} query.repo - The repo of the pull request.
   * @param {number} query.id - The pull request id.
   * @param {string} query.token - The user token used for authentication.
   * @return {Promise<Object.<string, string | number>>} - A promise.
   */
  async getPullRequest(query) {
    const bitbucket = this.getApi({
      service_auth: {
        refreshToken: query.refreshToken
      }
    });

    return new Promise((resolve, reject) => {

      bitbucket.repos.getPullRequest(query, (error, pullRequest) => {
        if (error) {
          this.logger.error({error}, 'Failed to get pull request');

          return reject(error);
        }

        let output = {
          id: pullRequest.id,
          number: pullRequest.id,
          state: pullRequest.state === 'OPEN' ? 'open' : 'closed',
          url: pullRequest.url,
          title: pullRequest.title,
          userName: pullRequest.author.username || pullRequest.author.nickname,
          userId: pullRequest.author.uuid,
        };

        return resolve(output);
      });

    });

  }

}

module.exports = Bitbucket;
