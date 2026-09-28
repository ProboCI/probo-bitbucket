'use strict';

var should = require('should');
var nock = require('nock');

var BitbucketApi = require('../lib/bitbucket/BitbucketApi');
var BitbucketHandler = require('../lib/BitbucketHandler');
var API = require('../lib/api');

var BB_OAUTH = 'https://bitbucket.org';
var BB_API = 'https://api.bitbucket.org';
var COORDINATOR = 'http://localhost:3999';

var EXPIRED_BODY = {
  type: 'error',
  error: {message: 'OAuth2 access token expired. Use your refresh token to obtain a new access token.'},
};

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

  before(function() {
    // Any request that reaches the network here is a bug in the refresh
    // sharing: it means a second refresh was attempted for the same token.
    nock.disableNetConnect();
  });

  after(function() {
    nock.enableNetConnect();
  });

  afterEach(function() {
    nock.cleanAll();
    // Rotations are remembered process-wide, keyed by the refresh token, and
    // every test here reuses the same token strings.
    BitbucketApi.resetRefreshState();
  });

  describe('BitbucketApi.refreshToken', function() {

    it('swaps in the new access token and notifies the caller', function(done) {
      var notified = null;
      var api = makeApi({onTokenRefreshed: function(body, previous, meta) {
        notified = {body: body, previous: previous, meta: meta};
      }});

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', expires_in: 7200});

      api.refreshToken(function(err, body) {
        should.not.exist(err);
        body.access_token.should.equal('new-access-token');

        api.auth.token.should.equal('new-access-token');
        api.oauth.headers.authorization.should.equal('Bearer new-access-token');

        should.exist(notified);
        notified.body.access_token.should.equal('new-access-token');
        // The caller needs the pair that was consumed to find every stored
        // copy of it.
        notified.previous.should.eql({token: 'old-access-token', refreshToken: 'stored-refresh-token'});
        notified.meta.origin.should.equal('refresh');

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

    it('treats a rotated-away refresh token as needing re-authorization', function(done) {
      // This is how Bitbucket reports a refresh token that a later refresh
      // has already replaced.
      var api = makeApi();

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(400, {error: 'unauthorized_client', error_description: 'refresh_token is invalid'});

      api.refreshToken(function(err) {
        should.exist(err);
        err.reauthorize.should.equal(true);
        done();
      });
    });

    it('errors without a refresh token rather than asking Bitbucket', function(done) {
      var api = makeApi({auth: {token: 'old-access-token', consumerKey: 'key', consumerSecret: 'secret'}});

      api.refreshToken(function(err) {
        should.exist(err);
        err.reauthorize.should.equal(true);
        done();
      });
    });

    it('shares one refresh between clients holding the same refresh token', function(done) {
      // Every request builds its own client, so two requests that hit an
      // expired token at the same time both want to refresh. Bitbucket
      // rotates refresh tokens, so the second refresh would be rejected.
      var origins = [];
      var hook = function(body, previous, meta) { origins.push(meta.origin); };
      var first = makeApi({onTokenRefreshed: hook});
      var second = makeApi({onTokenRefreshed: hook});

      var scope = nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token'});

      var remaining = 2;
      var finish = function(err) {
        should.not.exist(err);
        if (--remaining) return;

        scope.isDone().should.equal(true);
        first.auth.token.should.equal('new-access-token');
        second.auth.token.should.equal('new-access-token');
        first.auth.refreshToken.should.equal('rotated-refresh-token');
        second.auth.refreshToken.should.equal('rotated-refresh-token');
        // Only the client that talked to Bitbucket should persist.
        origins.sort().should.eql(['pending', 'refresh']);
        done();
      };

      first.refreshToken(finish);
      second.refreshToken(finish);
    });

    it('hands a later client the pair that replaced an already-consumed refresh token', function(done) {
      var first = makeApi();

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: 7200});

      first.refreshToken(function(err) {
        should.not.exist(err);

        // A build status update arrives carrying the project as it was before
        // the refresh above. Its refresh token is dead at Bitbucket.
        var origin = null;
        var second = makeApi({onTokenRefreshed: function(body, previous, meta) { origin = meta.origin; }});

        second.refreshToken(function(err, body) {
          should.not.exist(err);
          body.access_token.should.equal('new-access-token');
          second.auth.token.should.equal('new-access-token');
          second.auth.refreshToken.should.equal('rotated-refresh-token');
          origin.should.equal('cache');
          done();
        });
      });
    });

    it('moves on to the newest refresh token when the remembered pair has expired', function(done) {
      var first = makeApi();

      // expires_in of one second is well inside the safety margin, so the
      // remembered access token is never handed out.
      nock(BB_OAUTH)
        .post('/site/oauth2/access_token', /refresh_token=stored-refresh-token/)
        .reply(200, {access_token: 'short-lived-token', refresh_token: 'rotated-refresh-token', expires_in: 1});

      first.refreshToken(function(err) {
        should.not.exist(err);

        var chained = nock(BB_OAUTH)
          .post('/site/oauth2/access_token', /refresh_token=rotated-refresh-token/)
          .reply(200, {access_token: 'newest-access-token', refresh_token: 'newest-refresh-token', expires_in: 7200});

        var second = makeApi();
        second.refreshToken(function(err) {
          should.not.exist(err);
          chained.isDone().should.equal(true);
          second.auth.token.should.equal('newest-access-token');
          second.auth.refreshToken.should.equal('newest-refresh-token');
          done();
        });
      });
    });
  });

  describe('BitbucketApi.isTokenError', function() {

    // Bitbucket has shipped both wordings. Matching only the older one meant
    // http() never refreshed, and an expired token failed the build outright.
    it('recognizes both of the expiry messages Bitbucket sends', function() {
      var api = makeApi();

      api.isTokenError({error: {message: 'Access token expired. Use your refresh token to obtain a new access token.'}})
        .should.equal(true);
      api.isTokenError({error: {message: 'OAuth2 access token expired. Use your refresh token to obtain a new access token.'}})
        .should.equal(true);
    });

    it('does not treat unrelated errors as token expiry', function() {
      var api = makeApi();

      api.isTokenError({error: {message: 'Repository not found'}}).should.equal(false);
      api.isTokenError({}).should.equal(false);
      api.isTokenError(null).should.equal(false);
    });
  });

  describe('BitbucketApi.http', function() {

    it('refreshes and retries when the access token has expired', function(done) {
      var api = makeApi();

      nock(BB_API)
        .get('/2.0/repositories/owner/repo/src')
        .reply(401, EXPIRED_BODY);

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token'});

      var retry = nock(BB_API, {
        reqheaders: {authorization: 'Bearer new-access-token'},
      })
        .get('/2.0/repositories/owner/repo/src')
        .reply(200, {values: []});

      api.http({path: '/repositories/owner/repo/src'}, function(err, res, body) {
        should.not.exist(err);
        body.values.should.eql([]);
        retry.isDone().should.equal(true);
        done();
      });
    });

    it('gives up when the refresh itself fails', function(done) {
      var api = makeApi();

      nock(BB_API)
        .get('/2.0/repositories/owner/repo/src')
        .reply(401, EXPIRED_BODY);

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(400, {error: 'invalid_grant', error_description: 'Invalid refresh_token'});

      api.http({path: '/repositories/owner/repo/src'}, function(err) {
        should.exist(err);
        err.message.should.match(/Unable to refresh Bitbucket access token/);
        err.reauthorize.should.equal(true);
        done();
      });
    });
  });

  describe('API.updateTokens', function() {

    function makeCoordinatorApi(overrides) {
      return new API(Object.assign({url: COORDINATOR, token: 'coordinator-token', log: log}, overrides || {}));
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
        should.not.exist(captured.previousrefreshtoken);

        scope.done();
        done();
      });
    });

    it('sends the rotated pair along with the refresh token it replaced', function(done) {
      var captured = null;

      nock(COORDINATOR)
        .post('/projects/tokens')
        .reply(200, function() {
          captured = this.req.headers;
          return {ok: true};
        });

      var project = {id: 'proj-1', service_auth: {refreshToken: 'rotated-refresh-token'}};
      var tokens = {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token'};
      var previous = {token: 'old-access-token', refreshToken: 'stored-refresh-token'};

      makeCoordinatorApi().updateTokens(project, tokens, previous, function(err) {
        should.not.exist(err);
        captured.refreshtoken.should.equal('rotated-refresh-token');
        // The coordinator uses this to find every project and profile still
        // holding the dead token.
        captured.previousrefreshtoken.should.equal('stored-refresh-token');
        done();
      });
    });

    it('retries when the coordinator is unreachable or failing', function(done) {
      var attempts = 0;

      nock(COORDINATOR)
        .post('/projects/tokens')
        .reply(500, function() { attempts++; return {error: 'boom'}; })
        .post('/projects/tokens')
        .replyWithError('connection reset')
        .post('/projects/tokens')
        .reply(200, function() { attempts++; return {ok: true}; });

      var api = makeCoordinatorApi({tokenPersistRetryDelays: [1, 1, 1]});
      api.updateTokens({id: 'proj-1'}, {access_token: 'new-access-token'}, function(err) {
        should.not.exist(err);
        // The 500 and the final 200 are counted; the dropped connection is not.
        attempts.should.equal(2);
        done();
      });
    });

    it('does not retry a payload the coordinator rejected', function(done) {
      var attempts = 0;

      nock(COORDINATOR)
        .post('/projects/tokens')
        .times(2)
        .reply(400, function() { attempts++; return {error: 'nope'}; });

      var api = makeCoordinatorApi({tokenPersistRetryDelays: [1, 1, 1]});
      api.updateTokens({id: 'proj-1'}, {access_token: 'new-access-token'}, function(err) {
        should.exist(err);
        attempts.should.equal(1);
        done();
      });
    });

    it('gives up after the retries are exhausted', function(done) {
      var attempts = 0;

      nock(COORDINATOR)
        .post('/projects/tokens')
        .times(3)
        .reply(503, function() { attempts++; return {error: 'down'}; });

      var api = makeCoordinatorApi({tokenPersistRetryDelays: [1, 1]});
      api.updateTokens({id: 'proj-1'}, {access_token: 'new-access-token'}, function(err) {
        should.exist(err);
        attempts.should.equal(3);
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

    function makeHandler() {
      return new BitbucketHandler({
        bbWebhookUrl: '/bitbucket',
        bbClientKey: 'key',
        bbClientSecret: 'secret',
        port: 0,
        api: {url: COORDINATOR, token: 'coordinator-token'},
        log_level: Number.POSITIVE_INFINITY,
      });
    }

    function makeProject() {
      return {
        id: 'proj-1',
        owner: 'zanchin',
        repo: 'testrepo',
        slug: 'zanchin/testrepo',
        service_auth: {token: 'expired-token', refreshToken: 'stored-refresh-token'},
      };
    }

    it('persists to the coordinator when a request triggers a refresh', function(done) {
      var handler = makeHandler();
      var project = makeProject();

      // First call fails as expired, refresh succeeds, retry succeeds.
      nock(BB_API)
        .get('/2.0/repositories/zanchin/testrepo/commit/abc123')
        .reply(401, EXPIRED_BODY)
        .get('/2.0/repositories/zanchin/testrepo/commit/abc123')
        .reply(200, {hash: 'abc123', message: 'a commit'});

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: 7200});

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
        project.service_auth.refreshToken.should.equal('rotated-refresh-token');

        // ...and the coordinator got the write-back so the next webhook
        // doesn't start from the stale token again.
        setTimeout(function() {
          should.exist(persisted);
          persisted.projectid.should.equal('proj-1');
          persisted.providertype.should.equal('bitbucket');
          persisted.token.should.equal('new-access-token');
          persisted.refreshtoken.should.equal('rotated-refresh-token');
          persisted.previousrefreshtoken.should.equal('stored-refresh-token');
          done();
        }, 50);
      });
    });

    it('writes back once when two requests refresh the same token at the same time', function(done) {
      var handler = makeHandler();
      var project = makeProject();

      nock(BB_API)
        .get('/2.0/repositories/zanchin/testrepo/commit/abc123')
        .times(2)
        .reply(401, EXPIRED_BODY)
        .get('/2.0/repositories/zanchin/testrepo/commit/abc123')
        .times(2)
        .reply(200, {hash: 'abc123', message: 'a commit'});

      var refreshes = nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: 7200});

      var writes = 0;
      nock(COORDINATOR)
        .post('/projects/tokens')
        .times(2)
        .reply(200, function() { writes++; return {ok: true}; });

      // Two operations on the same project, each with its own client, as a
      // webhook and a status update would be.
      var first = handler.getBitbucketApi(project);
      var second = handler.getBitbucketApi(project);

      var remaining = 2;
      var finish = function(err, commit) {
        should.not.exist(err);
        commit.hash.should.equal('abc123');
        if (--remaining) return;

        setTimeout(function() {
          refreshes.isDone().should.equal(true);
          writes.should.equal(1);
          done();
        }, 50);
      };

      first.repos.getCommit({owner: 'zanchin', repo: 'testrepo', ref: 'abc123'}, finish);
      second.repos.getCommit({owner: 'zanchin', repo: 'testrepo', ref: 'abc123'}, finish);
    });
  });
});
