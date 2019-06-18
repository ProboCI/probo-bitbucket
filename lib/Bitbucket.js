
const yaml = require('js-yaml');

const BitbucketApi = require('./bitbucket/BitbucketApi');

class Bitbucket {

  constructor(config, log) {
    this.config = config;
    this.config.log = log;
    this.log = log;
  }

  /**
   * Builds options for GitLab API and returns a client object.
   *
   * @param {object} project - A project object.
   * @return {object} - An instantiated and configured Gitlab client object.
   */
  getApi(project) {
    if (!this.client) {

      this.client = new BitbucketApi({
        log: this.log,
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
   * @param {function} cb - The callback function to call on success/failure.
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
   * @param {Object} project - The project object, with the following properties:
   * @param {string} project.repo - The repo name, ie 'my-cool-project'.
   * @param {string} project.owner - The repo owner, ie 'dzinkevich'.
   * @param {string} sha - A hash representing the commit from which to fetch .probo.yaml.
   * @param {function} cb - The callback to pass the .probo.yaml into.
   */
  fetchProboYamlConfig(project, sha, cb) {

    try {
      this.getApi(project);
    }
    catch (e) {
      return cb(e);
    }

    let args = {
      accountName: project.owner,
      repositorySlug: project.repo,
      ref: sha,
      path: ''
    }

    this.client.repos.getContent(args, (error, files) => {
      if (error) return cb(error);

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
        return cb(new Error('No .probo.yml file was found.'));
      }

      this.log.info('Found probo config file: ' + file.path);

      return this.fetchYamlFile(file.path, sha, project, cb);
    });
  }

  /**
   * Fetches a YAML file from Bitbucket repo.
   *
   * @param {string} path - The path of the file to fetch.
   * @param {string} sha - The git commit id to fetch the .probo.yaml from.
   * @param {object} project - The project object.
   * @param {function} cb - The callback to call upon error/completion.
   */
  fetchYamlFile(path, sha, project, cb) {
    let args = {
      accountName: project.owner,
      repositorySlug: project.repo,
      ref: sha,
      path: path
    }

    this.client.repos.getContent(args, (error, content) => {
      if (error) {
        this.log.error({err: error}, 'Failed to get probo config file contents');

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
   * @param {Object} project - An object with the necessary structure needed for this.getBitbucketApi, as well as:
   * @param {string} project.repo - The name of the repo, ie 'my-cool-project'.
   * @param {string} sha - A hash representing the commit to which we should attach a status update.
   * @param {Object} statusInfo - An object with the following properties:
   * @param {string} statusInfo.state - The state of the status.
   * @param {string} statusInfo.description - The body of the status.,
   * @param {string} statusInfo.key - A name for the update (max 40 characters).
   * @param {string} statusInfo.url - The URL for the status update.
   * @param {function} cb - The callback for after the status has been posted.
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
