'use strict';
var util = require('util');
var request = require('request');
var should = require('should');

var sinon = require('sinon');
var nock = require('nock');
var nockout = require('./__nocker');

var BitbucketHandler = require('../lib/BitbucketHandler');

var config = {
  bbWebhookUrl: '/bbh',
  bbClientKey: 'changeme',
  bbClientSecret: 'changemetoo',
  port: 0,
  api: {
    url: 'http://localhost:3000',
    token: 'token',
  },
  logLevel: 0//Number.POSITIVE_INFINITY,
};

var bhhServer = new BitbucketHandler(config);

function http(path, bhh) {
  bhh = bhh || bhhServer;
  var options = {
    url: util.format('%s%s', bhh.server.url, path),
    json: true,
  };

  return request.defaults(options);
}

describe('webhooks', function() {
  before('start BitbucketHandler server', function(done) {
    bhhServer.start(done);
  });

  after('stop BitbucketHandler server', function(done) {
    bhhServer.stop(done);
  });

  describe('pull', function() {
    var nocker;
    beforeEach('nock out network calls', function() {
      nocker = initNock('pullrequest_payload.json');
    });

    afterEach('reset network mocks', function() {
      nocker.cleanup();
    });

    it('is routed', function(done) {
      var payload = require('./fixtures/pullrequest_payload');
      var headers = {
        'x-hook-uuid': 'a60aa880-df33-11e4-857c-eca3ec12497c',
        'x-event-key': 'pullrequest:created',
      };

      http(config.bitbucketWebhookPath)
      .post({body: payload, headers: headers}, function(err, res, body) {
        // handles push by returning OK and doing nothing else
        console.log('body' + err);
        body.should.eql({ok: true});
        should.not.exist(err);

        // TODO: WAT? why isn't this a set of async callbacks so we actually know when it's done?!
        // pause for a little before finishing to allow push processing to run
        // and hit all the GH nocked endpoints
        setTimeout(done, 200);
      });
    });


    it('is handled', function(done) {
      var payload = require('./fixtures/pull_payload');

      // fire off handler event
      var event = {
        event: 'pull_request',
        id: 'a60aa880-df33-11e4-857c-eca3ec12497c',
        url: '/bhh',
        payload: payload,
      };
      bhhServer.pullRequestHandler(event, function(err, build) {
        should.not.exist(err);
        build.should.eql({
          id: 'build1',
          projectId: '1234',
          ref: '9dd7d8b3ccf6cdecc86920535e52c4d50da7bd64',
          // Normalize pull request identifier to a string.
          pullRequest: '1',
          branch: 'feature',
          config: {
            fetcher_config: {
              'environment.remote': 'dev',
              'info_fetcher.class': 'FetcherServices\\InfoFetcher\\FetcherServices',
              'info_fetcher.config': {
                host: 'https://extranet.zivtech.com',
              },
              'name': 'awesome',
            },
            image: 'lepew/ubuntu-14.04-lamp',
            provisioner: 'fetcher',
          },
          project: {
            id: '1234',
            // provider_id: 33704441,
            owner: 'dzinkevich',
            repo: 'probo-test',
            service: 'bitbucket',
            slug: 'dzinkevich/probo-test',
          },
          request: {
            branch: 'feature',
            pull_request_id: 33015959,
            owner: 'dzinkevich',
            pull_request: 1,
            repo: 'probo-test',
            repo_id: 33704441,
            service: 'bitbucket',
            sha: '9dd7d8b3ccf6cdecc86920535e52c4d50da7bd64',
            slug: 'dzinkevich/probo-test',
            type: 'pull_request',
            payload: payload,
          },
        });

        done();
      });
    });
  });
  /*
  describe('push', function() {
    it('is handled', function(done) {
      var payload = require('./push_payload');

      var headers = {
        'X-Bitbucket-Event': 'push',
        'X-Bitbucket-Delivery': '8ec7bd00-df2b-11e4-9807-657b8ba6b6bd',
        'X-Hub-Signature': 'sha1=cb4c474352a7708d24fffa864dab9919f54ac2f6',
      };

      http(config.bitbucketWebhookPath)
        .post({body: payload, headers: headers}, function(err, res, body) {
          // handles push bu returning OK and doing nothing else
          body.should.eql({ok: true});
          done();
        });
    });
  });*/
});


/*
describe('status update endpoint', function() {
  var bhh;
  var mocked;

  before('start another bhh', function(done) {
    bhh = new BitbucketHandler(config);
    bhh.start(function() {
      nock.enableNetConnect(bhh.server.url.replace('http://', ''));
      done();
    });
  });

  before('set up mocks', function() {
    // call the first cb arg w/ no arguments
    mocked = sinon.stub(bhh, 'postStatusToBitbucket').yields();
  });

  after('clear mocks', function() {
    mocked.reset();
  });

  it('accepts /update', function(done) {

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

    http('/update', bhh).post({body: {
      update: update,
      build: build,
    }}, function _(err, res, body) {
      should.not.exist(err);
      body.should.eql(update);

      done(err);
    });
  });

  it('accepts /builds/:bid/status/:context', function(done) {
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

    http('/builds/' + build.id + '/status/' + 'ci-env', bhh).post({
      body: {
        update: update,
        build: build,
      },
    }, function(err, res, body) {
      should.not.exist(err);
      body.should.eql({
        state: 'pending',
        description: 'Environment built!',
        // NOTE context gets inserted from URL.
        context: 'ci-env',
        target_url: 'http://my_url.com',
      });

      done(err);
    });
  });
});


describe('probo.yaml file parsing', function() {
  var mocks = [];
  var updateSpy;
  var bhh;

  var errorMessage = `Failed to parse .probo.yaml:bad indentation of a mapping entry at line 3, column 3:
      command: 'bad command'
      ^`;

  before('init mocks', function() {
    bhh = new BitbucketHandler(config);

    // mock out Bitbucket API calls
    mocks.push(sinon.stub(bhh, 'getBitbucketApi').returns({
      repos: {
        getContent: function(opts, cb) {
          if (opts.path === '') {
            // listing of files
            cb(null, [{name: '.probo.yaml'}]);
          }
          else {
            // Getting content of a file - return a malformed YAML file.
            cb(null, {
              path: '.probo.yaml',
              content: new Buffer(`steps:
  - name: task
  command: 'bad command'`).toString('base64'),
            });
          }
        },
      },
    }));

    // mock out internal API calls
    mocks.push(
      sinon.stub(bhh.api, 'findProjectByRepo').yields(null, {})
    );

    // ensure that buildStatusUpdateHandler is called
    updateSpy = sinon.stub(bhh, 'buildStatusUpdateHandler').yields();
    mocks.push(updateSpy);
  });

  after('restore mocks', function() {
    mocks.forEach(function(mock) {
      mock.reset();
    });
  });

  it('throws an error for a bad yaml', function(done) {
    bhh.fetchProboYamlConfigFromBitbucket({}, null, function(err) {
      console.log(err);
      err.message.should.eql(errorMessage);
      done();
    });
  });

  it('sends status update for bad yaml', function(done) {
    bhh.processRequest({sha: 'sha1'}, function() {
      var param1 = {
        state: 'failure',
        description: errorMessage,
        context: 'ProboCI/env',
      };
      var param2 = {
        ref: 'sha1',
        project: {},
      };
      updateSpy.calledWith(param1, param2).should.equal(true);
      done();
    });
  });
});
*/
function initNock() {
  var project = {
    id: '1234',
    service: 'bitbucket',
    owner: 'dzinkevich',
    repo: 'probo-test',
    slug: 'dzinkevich/probo-test',
  };

  var buildId = 'build1';

  // nock out bhh server - pass these requests through
  nock.enableNetConnect(bhhServer.server.url.replace('http://', ''));

  // Nock out bitbucket URLs.
  return nockout('bitbucket.json', {
    not_required: ['status_update'],
    processor: function(nocks) {
      // nock out API URLs
      nocks.push(nock(config.api.url)
                 .get('/projects?service=bitbucket&slug=dzinkevich%2Fprobo-test&single=true')
                 .reply(200, project));
      nocks[nocks.length - 1].name = 'project_search';

      nocks.push(nock(config.api.url)
                 .post('/startbuild')
                 .reply(200, function(uri, requestBody) {
                   // start build sets id and project id on build
                   // and puts project inside build, returning build
                   var body = JSON.parse(requestBody);
                   body.build.id = buildId;
                   body.build.projectId = body.project.id;
                   body.build.project = body.project;
                   delete body.project;
                   return body.build;
                 }, {
                   'content-type': 'application/json',
                 }));
      nocks[nocks.length - 1].name = 'startbuild';

      nocks.push(nock(config.api.url)
                 .persist()
                 .filteringPath(/status\/[^/]*/g, 'status/context')
                 .post('/builds/' + buildId + '/status/context')
                 .reply(200, {
                   state: 'success',
                   description: 'Tests passed Thu Apr 30 2015 17:41:43 GMT-0400 (EDT)',
                   context: 'ci/tests',
                 }));
      nocks[nocks.length - 1].name = 'status_update';
    },
  });
}
