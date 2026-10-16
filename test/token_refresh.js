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

// What Bitbucket sends for an expired token since its 2026 OAuth changes.
var INVALID_BODY = {
  type: 'error',
  error: {message: 'Token is invalid, expired, or not supported for this endpoint.'},
};

var prPayload = require('./pullrequest_payload.json');

// nock body matcher for a refresh of one particular refresh token.
function refreshOf(refreshToken) {
  return function(form) {
    var sent = typeof form === 'string' ? require('querystring').parse(form).refresh_token : form.refresh_token;
    return sent === refreshToken;
  };
}

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

    it('treats a refresh token Bitbucket does not recognize as needing re-authorization', function() {
      BitbucketApi.isDeadRefreshToken({error: 'invalid_request', error_description: 'Invalid refresh_token'})
        .should.equal(true);
      BitbucketApi.isDeadRefreshToken({error: 'unauthorized_client', error_description: 'refresh_token is invalid'})
        .should.equal(true);
      BitbucketApi.isDeadRefreshToken({error: 'invalid_request', error_description: 'Missing grant_type'})
        .should.equal(false);
    });

    it('asks Bitbucket with a timeout so a silent endpoint cannot wedge the chain', function(done) {
      // This nock is too old to emulate socket timeouts, so check the option
      // on the way out instead.
      var request = require('request');
      var originalPost = request.post;
      var sent = null;
      request.post = function(options, cb) {
        sent = options;
        return originalPost.call(request, options, cb);
      };

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token'});

      makeApi({refreshTimeoutMs: 1234}).refreshToken(function(err) {
        request.post = originalPost;
        should.not.exist(err);
        sent.timeout.should.equal(1234);
        done();
      });
    });

    it('fails instead of hanging when Bitbucket does not answer', function(done) {
      var api = makeApi();
      var timeout = new Error('ESOCKETTIMEDOUT');
      timeout.code = 'ESOCKETTIMEDOUT';

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .replyWithError(timeout);

      api.refreshToken(function(err) {
        should.exist(err);
        err.message.should.match(/no answer from Bitbucket/);
        err.reauthorize.should.equal(false);

        // The failed attempt must not leave later refreshes waiting on it.
        nock(BB_OAUTH)
          .post('/site/oauth2/access_token')
          .reply(200, {access_token: 'new-access-token'});

        makeApi().refreshToken(function(err2, body) {
          should.not.exist(err2);
          body.access_token.should.equal('new-access-token');
          done();
        });
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

    it('recognizes the wording Bitbucket uses since its 2026 OAuth changes', function() {
      var api = makeApi();

      api.isTokenError(INVALID_BODY).should.equal(true);
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

    // What Bitbucket sends for an expired token since its 2026 OAuth changes;
    // none of it matches isTokenError, so only the 401 says to refresh.
    it('refreshes and retries on a 401 whatever the message says', function(done) {
      var api = makeApi();

      nock(BB_API)
        .get('/2.0/repositories/owner/repo/refs/branches?pagelen=100')
        .reply(401, {type: 'error', error: {message: 'Token is invalid, expired, or not supported for this endpoint.'}});

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token'});

      var retry = nock(BB_API, {
        reqheaders: {authorization: 'Bearer new-access-token'},
      })
        .get('/2.0/repositories/owner/repo/refs/branches?pagelen=100')
        .reply(200, {values: [{name: 'main', target: {hash: 'abc123'}}]});

      api.repos.getBranches({owner: 'owner', repo: 'repo'}, function(err, branches) {
        should.not.exist(err);
        branches.should.eql([{name: 'main', sha: 'abc123'}]);
        retry.isDone().should.equal(true);
        api.auth.refreshToken.should.equal('rotated-refresh-token');
        done();
      });
    });

    it('does not refresh on errors other than a 401', function(done) {
      var api = makeApi();

      nock(BB_API)
        .get('/2.0/repositories/owner/repo/src')
        .reply(404, {type: 'error', error: {message: 'Repository not found'}});

      // nock.disableNetConnect() fails the test if a refresh is attempted.
      api.http({path: '/repositories/owner/repo/src'}, function(err) {
        should.exist(err);
        err.statusCode.should.equal(404);
        done();
      });
    });

    it('refreshes before the first request when the stored token is known to have expired', function(done) {
      var api = makeApi({auth: {
        token: 'expired-token',
        refreshToken: 'stored-refresh-token',
        tokenCreatedAt: Math.floor(Date.now() / 1000) - 8000,
        tokenExpiresIn: 7200,
        consumerKey: 'key',
        consumerSecret: 'secret',
      }});

      // No interceptor accepts the expired token: sending it fails the test.
      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: 7200});

      nock(BB_API, {reqheaders: {authorization: 'Bearer new-access-token'}})
        .get('/2.0/repositories/owner/repo/src')
        .reply(200, {values: []});

      api.http({path: '/repositories/owner/repo/src'}, function(err, res, body) {
        should.not.exist(err);
        body.values.should.eql([]);
        api.isAccessTokenExpired().should.equal(false);
        done();
      });
    });

    it('refreshes on a token error whatever the status code', function(done) {
      var api = makeApi();

      nock(BB_API)
        .get('/2.0/repositories/owner/repo/src')
        .reply(403, INVALID_BODY);

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token'});

      var retry = nock(BB_API, {reqheaders: {authorization: 'Bearer new-access-token'}})
        .get('/2.0/repositories/owner/repo/src')
        .reply(200, {values: []});

      api.http({path: '/repositories/owner/repo/src'}, function(err) {
        should.not.exist(err);
        retry.isDone().should.equal(true);
        done();
      });
    });

    it('refreshes against Bitbucket when a remembered token is rejected', function(done) {
      // An earlier client in this process already rotated the stored token.
      nock(BB_OAUTH)
        .post('/site/oauth2/access_token', refreshOf('stored-refresh-token'))
        .reply(200, {access_token: 'remembered-access-token', refresh_token: 'rotated-refresh-token', expires_in: 7200});

      makeApi().refreshToken(function(err) {
        should.not.exist(err);

        // A later client still holds the pair from the database. Its token is
        // rejected, so is the remembered one (revoked in the meantime), and
        // only a real refresh with the newest refresh token gets through.
        var api = makeApi();

        nock(BB_API, {reqheaders: {authorization: 'Bearer old-access-token'}})
          .get('/2.0/repositories/owner/repo/src')
          .reply(401, INVALID_BODY);
        nock(BB_API, {reqheaders: {authorization: 'Bearer remembered-access-token'}})
          .get('/2.0/repositories/owner/repo/src')
          .reply(401, INVALID_BODY);

        var forced = nock(BB_OAUTH)
          .post('/site/oauth2/access_token', refreshOf('rotated-refresh-token'))
          .reply(200, {access_token: 'fresh-access-token', refresh_token: 'newest-refresh-token', expires_in: 7200});

        var retry = nock(BB_API, {reqheaders: {authorization: 'Bearer fresh-access-token'}})
          .get('/2.0/repositories/owner/repo/src')
          .reply(200, {values: []});

        api.http({path: '/repositories/owner/repo/src'}, function(err, res, body) {
          should.not.exist(err);
          body.values.should.eql([]);
          forced.isDone().should.equal(true);
          retry.isDone().should.equal(true);
          api.auth.refreshToken.should.equal('newest-refresh-token');
          done();
        });
      });
    });

    it('does not loop when a freshly refreshed token is rejected too', function(done) {
      var api = makeApi();

      nock(BB_API)
        .get('/2.0/repositories/owner/repo/src')
        .times(2)
        .reply(401, INVALID_BODY);

      var refresh = nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token'});

      api.http({path: '/repositories/owner/repo/src'}, function(err) {
        should.exist(err);
        err.statusCode.should.equal(401);
        refresh.isDone().should.equal(true);
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

    function callController(handler, name, params, query, cb) {
      var req = {params: params, query: query, log: log};
      var res = {
        json: function(status, body) {
          cb(status, body);
        },
        send: function(status, body) {
          cb(status, body);
        },
      };

      handler[name](req, res, function() {});
    }

    it('answers a lookup with the stored access token instead of refreshing', function(done) {
      // No OAuth interceptor: a refresh here would fail the lookup.
      nock(BB_API)
        .get('/2.0/repositories/zanchin/testrepo/refs/branches?pagelen=100')
        .reply(200, {values: [{name: 'main', target: {hash: 'abc123'}}]});

      var query = {token: 'stored-access-token', refreshToken: 'stored-refresh-token', project_id: 'proj-1'};

      callController(makeHandler(), 'branchesController', {owner: 'zanchin', repo: 'testrepo'}, query, function(status, body) {
        status.should.equal(200);
        body.should.eql([{name: 'main', sha: 'abc123'}]);
        done();
      });
    });

    it('writes a refresh made for a lookup back to the project it names', function(done) {
      nock(BB_API)
        .get('/2.0/repositories/zanchin/testrepo/pullrequests/7')
        .reply(401, EXPIRED_BODY)
        .get('/2.0/repositories/zanchin/testrepo/pullrequests/7')
        .reply(200, {state: 'OPEN', title: 'A pull request', author: {username: 'zanchin', uuid: '{1}'}});

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

      var params = {owner: 'zanchin', repo: 'testrepo', pullRequestNumber: '7'};
      var query = {token: 'expired-token', refreshToken: 'stored-refresh-token', project_id: 'proj-1'};

      callController(makeHandler(), 'pullRequestController', params, query, function(status, body) {
        status.should.equal(200);
        body.state.should.equal('open');

        // Without the write-back the coordinator would keep the refresh token
        // Bitbucket just invalidated.
        setTimeout(function() {
          should.exist(persisted);
          persisted.projectid.should.equal('proj-1');
          persisted.token.should.equal('new-access-token');
          persisted.refreshtoken.should.equal('rotated-refresh-token');
          persisted.previousrefreshtoken.should.equal('stored-refresh-token');
          done();
        }, 50);
      });
    });

    // The three places an expired token used to behave differently: the PR
    // webhook, the project page's lookups and the build status post. All of
    // them must refresh, retry and write back the same way.

    it('builds a pull request after refreshing an expired token', function(done) {
      var handler = makeHandler();
      var sha = prPayload.pullrequest.source.commit.hash;

      nock(COORDINATOR)
        .get('/projects?service=bitbucket&slug=zanchin%2Ftest-repo&single=true')
        .reply(200, {
          id: 'proj-1',
          owner: 'zanchin',
          repo: 'test-repo',
          slug: 'zanchin/test-repo',
          service_auth: {token: 'expired-token', refreshToken: 'stored-refresh-token'},
        });

      // The stored token is rejected with Bitbucket's current wording, the
      // refresh succeeds, and both config fetches go out with the new token.
      nock(BB_API, {reqheaders: {authorization: 'Bearer expired-token'}})
        .get('/2.0/repositories/zanchin/test-repo/src/' + sha + '/?pagelen=100')
        .reply(401, INVALID_BODY);

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: 7200});

      nock(BB_API, {reqheaders: {authorization: 'Bearer new-access-token'}})
        .get('/2.0/repositories/zanchin/test-repo/src/' + sha + '/?pagelen=100')
        .reply(200, {values: [{path: '.probo.yml'}]})
        .get('/2.0/repositories/zanchin/test-repo/src/' + sha + '/.probo.yml?pagelen=100')
        .reply(200, 'steps:\n  - name: test\n', {'Content-Type': 'text/plain'});

      // This nock hands the reply function the raw request body and sends an
      // object reply without a content type, so parse and serialise by hand.
      var submitted = null;
      nock(COORDINATOR)
        .post('/startbuild')
        .reply(200, function(uri, body) {
          submitted = typeof body === 'string' ? JSON.parse(body) : body;
          return JSON.stringify({id: 'build-1'});
        }, {'Content-Type': 'application/json'});

      var persisted = null;
      nock(COORDINATOR)
        .post('/projects/tokens')
        .reply(200, function() {
          persisted = this.req.headers;
          return {ok: true};
        });

      var event = {event: 'pullrequest:created', payload: prPayload, hookId: 'hook-1', host: 'bitbucket.org'};

      handler.pullRequestHandler(event, function(err, build) {
        should.not.exist(err);
        build.id.should.equal('build-1');

        // The build went to the coordinator with the refreshed credentials...
        submitted.build.config.should.eql({steps: [{name: 'test'}]});
        submitted.project.service_auth.token.should.equal('new-access-token');
        submitted.project.service_auth.refreshToken.should.equal('rotated-refresh-token');

        // ...and the rotation was written back for the next webhook.
        setTimeout(function() {
          should.exist(persisted);
          persisted.projectid.should.equal('proj-1');
          persisted.token.should.equal('new-access-token');
          persisted.refreshtoken.should.equal('rotated-refresh-token');
          persisted.previousrefreshtoken.should.equal('stored-refresh-token');
          done();
        }, 50);
      });
    });

    it('serves the project page after refreshing an expired token', function(done) {
      nock(BB_API, {reqheaders: {authorization: 'Bearer expired-token'}})
        .get('/2.0/repositories/zanchin/testrepo/refs/branches?pagelen=100')
        .reply(401, INVALID_BODY);

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: 7200});

      nock(BB_API, {reqheaders: {authorization: 'Bearer new-access-token'}})
        .get('/2.0/repositories/zanchin/testrepo/refs/branches?pagelen=100')
        .reply(200, {values: [{name: 'main', target: {hash: 'abc123'}}]});

      var persisted = null;
      nock(COORDINATOR)
        .post('/projects/tokens')
        .reply(200, function() {
          persisted = this.req.headers;
          return {ok: true};
        });

      var query = {token: 'expired-token', refreshToken: 'stored-refresh-token', project_id: 'proj-1'};

      callController(makeHandler(), 'branchesController', {owner: 'zanchin', repo: 'testrepo'}, query, function(status, body) {
        status.should.equal(200);
        body.should.eql([{name: 'main', sha: 'abc123'}]);

        setTimeout(function() {
          should.exist(persisted);
          persisted.projectid.should.equal('proj-1');
          persisted.token.should.equal('new-access-token');
          persisted.refreshtoken.should.equal('rotated-refresh-token');
          done();
        }, 50);
      });
    });

    it('posts a build status after refreshing an expired token', function(done) {
      var handler = makeHandler();
      var project = makeProject();

      nock(BB_API, {reqheaders: {authorization: 'Bearer expired-token'}})
        .post('/2.0/repositories/zanchin/testrepo/commit/abc123/statuses/build')
        .reply(401, INVALID_BODY);

      nock(BB_OAUTH)
        .post('/site/oauth2/access_token')
        .reply(200, {access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: 7200});

      nock(BB_API, {reqheaders: {authorization: 'Bearer new-access-token'}})
        .post('/2.0/repositories/zanchin/testrepo/commit/abc123/statuses/build')
        .reply(201, {state: 'SUCCESSFUL', key: 'ProboCI/env'});

      nock(COORDINATOR)
        .post('/projects/tokens')
        .reply(200, {ok: true});

      var status = {state: 'SUCCESSFUL', key: 'ProboCI/env', url: 'https://example.test/build/1', description: 'done'};

      handler.postStatusToBitbucket(project, 'abc123', status, function(err, body) {
        should.not.exist(err);
        body.state.should.equal('SUCCESSFUL');
        project.service_auth.token.should.equal('new-access-token');
        done();
      });
    });

    it('writes a lookup back when the caller names the project', function(done) {
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

      var query = {refreshToken: 'stored-refresh-token', project_id: 'proj-1'};

      callController(makeHandler(), 'authLookupController', {}, query, function(status, body) {
        status.should.equal(200);
        body.access_token.should.equal('new-access-token');

        setTimeout(function() {
          should.exist(persisted);
          persisted.projectid.should.equal('proj-1');
          persisted.refreshtoken.should.equal('rotated-refresh-token');
          persisted.previousrefreshtoken.should.equal('stored-refresh-token');
          done();
        }, 50);
      });
    });
  });
});
