'use strict';

var util = require('util');
var request = require('request');
var should = require('should');
var bunyan = require('bunyan');
var BitbucketHandler = require('../lib/BitbucketHandler');

var config = {
  bitbucketWebhookPath: '/bitbucket',
  port: 0,
  api: {
    service: 'bitbucket',
    url: 'http://localhost:3000',
    token: 'VadnVNoK9qFYIYRMe3R7WgWzAg67_AYbNgNjLYkXekGao',
    refreshToken: 'yLHwBxav5L9swPuQvL'
  },
  bbWebhookUrl: 'http://app.local.probo.ci/bitbucket',
  bbClientKey: 'AaGukdu6qpWrB9pyeW',
  bbClientSecret: 'zryeH2WnGh4UK798GV2CE5WNkMCLHTbU',
  log_level: Number.POSITIVE_INFINITY,
  log: bunyan.createLogger({name: 'api-client', level: 'debug'}),
};

var handlerServer = new BitbucketHandler(config);

// mock out API calls
var nocked = {};
var requiredNocks = [];

var nock = require('nock');

function initNock() {
  // nock.enableNetConnect();

  nocked = {};

  var project = {
    id: '1234',
    service: 'bitbucket',
    owner: 'dzinkevich',
    repo: 'probo-test',
    slug: 'dzinkevich/probo-test',
    service_auth: config.api,
  };

  var build = {
    id: 'build1',
    projectId: '123',
    sha: 'd065740',
    project: project,
  };

  // nock out handler server - pass these requests through
  nock.enableNetConnect(handlerServer.server.url.replace('http://', ''));


  // nock out API URLs
  nocked.project_search = nock(config.api.url)
    .get('/projects?service=bitbucket&slug=dzinkevich%2Fprobo-test&single=true')
    .reply(200, project);

  nocked.startbuild = nock(config.api.url)
    .post('/startbuild')
    .reply(200, build);

  nocked.status_update = nock(config.api.url)
    .persist()
    .filteringPath(/status\/[^/]*/g, 'status/context')
    .post('/builds/' + build.id + '/status/context')
    .reply(200, {
      state: 'success',
      description: 'Tests passed Thu Apr 30 2015 17:41:43 GMT-0400 (EDT)',
      context: 'ci/tests',
    });

  // nock out bitbucket URLs
  var nocks = nock.load('./test/http_capture.json');
  nocks.forEach(function(n, i) {
    if (i !== 2) {
      nocked['bitbucket_' + i] = n;
    }
  });

  Object.keys(nocked)
    .filter(function(name) {
      var excluded = ['status_update'];
      return excluded.indexOf(name) < 0;
    })
    .forEach(function(name) {
      requiredNocks.push(nocked[name]);
    });

  // nock.recorder.rec({
  //   output_objects: true,
  //   dont_print: true
  // });
}

function http(path, handler) {
  handler = handler || handlerServer;
  var options = {
    url: util.format('%s%s', handler.server.url, path),
    json: true,
  };

  return request.defaults(options);
}

describe.only('webhooks', function() {
  before('start BitbucketHandler server', function(done) {
    handlerServer.start(done);
  });

  after('stop BitbucketHandler server', function(done) {
    handlerServer.stop(done);

    // var nockCallObjects = nock.recorder.play();
    // require('fs').writeFileSync("http_capture.json", util.inspect(nockCallObjects, null, 5));
  });


  describe.only('pullrequest', function() {
    beforeEach('nock out network calls', function() {
      nock.cleanAll();
      initNock();
    });

    it('is routed', function(done) {
      var payload = require('./pullrequest_payload');
      var headers = {};

      http(config.bitbucketWebhookPath)
      .post({body: payload, headers: headers}, function _(err, res, body) {
        // handles push by returning OK and doing nothing else
        console.log('pr is routed' + typeof body);
        body.should.eql({ok: true});
        should.not.exist(err);

        done();
      });
    });


    it('is handled', function(done) {
      var payload = require('./pullrequest_payload');

      // fire off handler event
      var event = {
        event: 'UPDATE',
        url: '/bitbucket',
        payload: payload[0],
      };
      handlerServer.pullRequestHandler(event, function(err, build) {
        console.log('pullrequesthandler response');
        should.not.exist(err);
        console.log(util.inspect(err, {showHidden: false, depth: null}));
        console.log('is handled' + typeof build);
        build.should.eql({
          id: 'build1',
          projectId: '1234',
          sha: '383e221f3f407055bd252c774df4ecdc1a04ed6e',
          project: {
            id: '1234',
            owner: 'TEST',
            repo: 'probo-test',
            service: 'bitbucket',
            slug: 'TEST/probo-test',
          },
        });

        // // makesure all internal calls were made
        // for(var nock_name in required_nocks){
        //   required_nocks[nock_name].done();
        // }

        done();
      });
    });
  });
});

describe('status update endpoint', function() {
  var handler;

  function mock(obj, attrName, newAttr) {
    var orig = obj[attrName];
    obj[attrName] = newAttr;

    function reset() {
      obj[attrName] = orig;
    }

    return {value: orig, reset: reset};
  }

  before('start another handler', function(done) {
    handler = new BitbucketHandler(config);
    handler.start(function() {
      nock.enableNetConnect(handler.server.url.replace('http://', ''));
      done();
    });
  });

  it('accepts /update', function(done) {
    var mocked = mock(handler, 'postStatusToBitbucket', function _(project, ref, status, cb) {
      // no-op
      mocked.reset();
      cb();
    });

    var update = {
      state: 'pending',
      description: 'Environment built!',
      context: 'ci/env',
      target_url: 'http://my_url.com',
    };

    var build = {
      projectId: '123',

      status: 'success',
      ref: 'd0fdf6c2d2b5e7402985f1e720aa27e40d018194',

      project: {
        id: '1234',
        service: 'bitbucket',
        owner: 'dzinkevich',
        repo: 'probo-test',
        slug: 'dzinkevich/probo-test',
      },
    };

    http('/update', handler)
      .post({body: {
        update: update,
        build: build,
      }}, function _(err, res, body) {
        should.not.exist(err);
        console.log('update ' + typeof body);
        body.should.eql(update);

        return done(err);
      });
  });

  it('accepts /builds/:bid/status/:context', function(done) {
    var mocked = mock(handler, 'postStatusToBitbucket', function _(project, ref, status, cb) {
      // no-op
      mocked.reset();
      cb();
    });

    var update = {
      state: 'pending',
      description: 'Environment built!',
      context: 'ignored context',
      target_url: 'http://my_url.com',
    };

    var build = {
      projectId: '123',

      status: 'success',
      ref: 'd0fdf6c2d2b5e7402985f1e720aa27e40d018194',

      project: {
        id: '1234',
        service: 'bitbucket',
        owner: 'dzinkevich',
        repo: 'probo-test',
        slug: 'dzinkevich/probo-test',
      },
    };

    http('/builds/' + build.id + '/status/' + 'ci-env', handler)
      .post({body: {
        update: update,
        build: build,
      }}, function _(err, res, body) {
        should.not.exist(err);
        console.log('accepts context ' + typeof body);
        body.should.eql({
          state: 'pending',
          description: 'Environment built!',
          context: 'ci-env',
          target_url: 'http://my_url.com',
        });

        return done(err);
      });
  });
});
