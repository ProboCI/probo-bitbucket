'use strict';

var should = require('should');
var nock = require('nock');

var BitbucketApi = require('../lib/bitbucket/BitbucketApi');
var BitbucketHandler = require('../lib/BitbucketHandler');
var API = require('../lib/api');

var BB_OAUTH = 'https://bitbucket.org';
var COORDINATOR = 'http://localhost:3999';

var log = {
  child: function() { return log; },
  info: function() {},
  debug: function() {},
  error: function() {},
  trace: function() {},
  warn: function() {},
};

function makeApi(overrides) {
  var auth = {
    token: 'old-access-token',
    refreshToken: 'stored-refresh-token',
    consumerKey: 'key',
    consumerSecret: 'secret',
  };

  return new BitbucketApi(Object.assign({log: log, auth: auth}, overrides || {}));
}

describe('token refresh', function() {

  afterEach(function() {
    nock.cleanAll();
  });

  describe('BitbucketApi.refreshToken', function() {

    it('swaps in the new access token and notifies the caller', function(done) {
      var notified = null;
      var api = makeApi({onTokenRefreshed: function(body) { notified = body; }});

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', expires_in: 7200});

      api.refreshToken(function(err, body) {
        should.not.exist(err);
        body.access_token.should.equal('new-access-token');

        api.auth.token.should.equal('new-access-token');
        api.oauth.headers.authorization.should.equal('Bearer new-access-token');

        should.exist(notified);
        notified.access_token.should.equal('new-access-token');

        done();
      });
    });

    it('keeps the stored refresh token when Bitbucket does not rotate one', function(done) {
      var api = makeApi();

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token'});

      api.refreshToken(function(err) {
        should.not.exist(err);
        api.auth.refreshToken.should.equal('stored-refresh-token');
        done();
      });
    });

    it('picks up a rotated refresh token', function(done) {
      var api = makeApi();

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token'});

      api.refreshToken(function(err) {
        should.not.exist(err);
        api.auth.refreshToken.should.equal('rotated-refresh-token');
        done();
      });
    });

    it('errors on a dead refresh token instead of reporting success', function(done) {
      var notified = false;
      var api = makeApi({onTokenRefreshed: function() { notified = true; }});

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(400, {error: 'invalid_grant', error_description: 'Invalid refresh_token'});

      api.refreshToken(function(err) {
        should.exist(err);
        err.message.should.match(/Invalid refresh_token/);
        err.reauthorize.should.equal(true);

        // The hook must not fire, or we would persist an empty token.
        notified.should.equal(false);

        // The old token stays put rather than being silently restored as if
        // the refresh had worked.
        api.auth.token.should.equal('old-access-token');

        done();
      });
    });
  });

  describe('API.updateTokens', function() {

    function makeCoordinatorApi() {
      return new API({url: COORDINATOR, token: 'coordinator-token', log: log});
    }

    it('posts the refreshed tokens to the coordinator', function(done) {
      var captured = null;

      var scope = nock(COORDINATOR)
        .post('/projects/tokens')
        .reply(200, function() {
          captured = this.req.headers;
          return {ok: true};
        });

      var project = {id: 'proj-1', service_auth: {refreshToken: 'stored-refresh-token'}};
      var tokens = {access_token: 'new-access-token', expires_in: 7200};

      makeCoordinatorApi().updateTokens(project, tokens, function(err) {
        should.not.exist(err);

        captured.projectid.should.equal('proj-1');
        captured.providertype.should.equal('bitbucket');
        captured.token.should.equal('new-access-token');
        captured.tokenexpiresin.should.equal('7200');
        // Bitbucket sent no refresh_token, so the stored one is echoed back
        // rather than clearing the column.
        captured.refreshtoken.should.equal('stored-refresh-token');

        scope.done();
        done();
      });
    });

    it('sends a rotated refresh token when Bitbucket issues one', function(done) {
      var captured = null;

      nock(COORDINATOR)
        .post('/projects/tokens')
        .reply(200, function() {
          captured = this.req.headers;
          return {ok: true};
        });

      var project = {id: 'proj-1', service_auth: {refreshToken: 'stored-refresh-token'}};
      var tokens = {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token'};

      makeCoordinatorApi().updateTokens(project, tokens, function(err) {
        should.not.exist(err);
        captured.refreshtoken.should.equal('rotated-refresh-token');
        done();
      });
    });

    it('skips projects with no id, such as bare refresh-token lookups', function(done) {
      // No nock interceptor: any HTTP call here would throw.
      var project = {service_auth: {refreshToken: 'stored-refresh-token'}};

      makeCoordinatorApi().updateTokens(project, {access_token: 'new'}, function(err) {
        should.not.exist(err);
        done();
      });
    });

    it('refuses to persist an empty access token', function(done) {
      makeCoordinatorApi().updateTokens({id: 'proj-1'}, {}, function(err) {
        should.exist(err);
        err.message.should.match(/empty Bitbucket access token/);
        done();
      });
    });
  });

  describe('BitbucketHandler wiring', function() {

    it('persists to the coordinator when a request triggers a refresh', function(done) {
      var handler = new BitbucketHandler({
        bbWebhookUrl: '/bitbucket',
        bbClientKey: 'key',
        bbClientSecret: 'secret',
        port: 0,
        api: {url: COORDINATOR, token: 'coordinator-token'},
        log_level: Number.POSITIVE_INFINITY,
      });

      var project = {
        id: 'proj-1',
        owner: 'zanchin',
        repo: 'testrepo',
        slug: 'zanchin/testrepo',
        service_auth: {token: 'expired-token', refreshToken: 'stored-refresh-token'},
      };

      var expiredBody = {
        type: 'error',
        error: {message: 'Access token expired. Use your refresh token to obtain a new access token.'},
      };

      // First call fails as expired, refresh succeeds, retry succeeds.
      nock('https://api.bitbucket.org')
        .get('/2.0/repositories/zanchin/testrepo/commit/abc123')
        .reply(401, expiredBody)
        .get('/2.0/repositories/zanchin/testrepo/commit/abc123')
        .reply(200, {hash: 'abc123', message: 'a commit'});

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', expires_in: 7200});

      var persisted = null;
      nock(COORDINATOR)
        .post('/projects/tokens')
        .reply(200, function() {
          persisted = this.req.headers;
          return {ok: true};
        });

      var bitbucket = handler.getBitbucketApi(project);

      bitbucket.repos.getCommit({owner: 'zanchin', repo: 'testrepo', ref: 'abc123'}, function(err, commit) {
        should.not.exist(err);
        commit.hash.should.equal('abc123');

        // In-memory project object is updated for the rest of this request...
        project.service_auth.token.should.equal('new-access-token');

        // ...and the coordinator got the write-back so the next webhook
        // doesn't start from the stale token again.
        setTimeout(function() {
          should.exist(persisted);
          persisted.projectid.should.equal('proj-1');
          persisted.providertype.should.equal('bitbucket');
          persisted.token.should.equal('new-access-token');
          done();
        }, 50);
      });
    });
  });
});
