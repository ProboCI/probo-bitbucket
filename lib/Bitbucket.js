
const yaml = require('js-yaml');

const BitbucketApi = require('./bitbucket/BitbucketApi');

class Bitbucket {

  constructor(config, log) {
    this.config = config;
    this.config.log = log;
    this.logger = log;
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

      this.client = new BitbucketApi({
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

    try {
      this.getApi(project);
    }
    catch (e) {
      return cb(e);
    }

    this.fetchYamlFile('.probo.yml', project, sha, (error, settings) => {
      console.log(error, settings);
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
    let args = {
      accountName: project.owner,
      repositorySlug: project.repo,
      ref: sha,
      path: path
    }

    this.client.repos.getContent(args, (error, content) => {
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
  postStatusToBitbucket(project, sha, statusInfo, cb) {

    try {
      this.getApi(project);
    }
    catch (e) {
      return cb(e);
    }

    this.client.statuses.create(statusInfo, {ref: sha, slug: project.slug}, (error, body) => {
      cb(error, body);
    });
  }

}

module.exports = Bitbucket;
