'use strict';

var should = require('should');
var Bitbucket = require('../lib/bitbucket');
var bunyan = require('bunyan');

var bitbucketConfig = {
  url: 'http://localhost:7990',
  auth: {
    type: 'oauth2',
    token: 'VadnVNoK9qFYIYRMe3R7WgWzAg67_AYbNgNjLYkXekGao',
    refreshToken: 'yLHwBxav5L9swPuQvL',
    consumerKey: 'bitbucket.local.key',
    consumerSecret: '-----BEGIN RSA PRIVATE KEY-----\nMIICXQIBAAKBgQCmxWGi4EA3JGYN6PUSer961SpbPdiyNjjqLn0zEWttUjRmkExt\nIEviIV3TClJkziwOXJ6ElDWGeaVmke42RMjq1/8eKlpcgGU6CZIxC9Yx9FS2Jhrg\nJnE91WbVZQn+2NagWK/WONOexO+vrZChWyIhgUqYp1VqJQ7A5lDfeX8dzQIDAQAB\nAoGAIdlyRdLqdcbHiA8+nu+XKeFWZYqaDyH+T1n8Q39HpLrItACZ4pRpko5fMtSn\ngJpwSsH10scaTh8muTjpds5jUSN3Ufy3yWBS7msgEsHnJj2HeJsQ5jvUFYpuv/5R\nDj4xB4GUCUP4X8eU2t1qfdnmu+KoskRMTVfW8N+i5XVztakCQQDVFwGnnwKXyPx0\nC3A6/EAmrZ3bPHZ9yqSnnu/vCDgD+7hMLVNMrxXLK0FriphKZMjNBXKimMQ1tKt1\nEFrCmqzLAkEAyFqXrewnwOHbAkp6uaS1oTOo0FMhFxy82XstOaI7jIupERlW2coq\nDx4HIwM9XclIW3/7i12Va3pm6mLK1lrkxwJBAJWfJuFMrGRpkqHk2jQApQbDh4DG\nDqk63ax41B4x1ist13VdqgzBL3tN7wyU72PlKn2S4rA6tiLDrlRvXFsigksCQQC/\nQxRXWQDeNf3f4v/jZuRo/irirOkC6lEyAE+9HC1izxRXmWv6vu6FvfGsL/SOKo+j\nobqdYXo5vwCuMh9WoDCTAkBfw9fpdz7G6NWkDJfBe7bMkCM/bm0r0GbsOyoPodDm\ny8yMvme9lXdOSiXUwhGgb9pnwt8e7TJbyX3u3r3+XeEz\n-----END RSA PRIVATE KEY-----',
  },
  log: bunyan.createLogger({name: 'api-client', level: 'debug'}),
};

var bitbucket = new Bitbucket(bitbucketConfig);

var nocker = require('./__nocker');

before(function() {
  // play (nock out bitbucket URLs):
  // var nocks = nocker.play('./test/bitbucket_capture.json');

  //nocker.record();
});

after('stop BitbucketHandler server', function() {
  // stop recording:
  //nocker.stop('./test/bitbucket_capture.json');
});

/*
describe('repos', function() {
  it('getAll', function(done) {
    bitbucket.repos.getAll(function(err, repos) {
      should.not.exist(err);

      repos.should.be.an.Array;
      repos.length.should.be.above(0);
      return done(err);
    });
  });

  it('getContent of a file', function(done) {
    var req = {
      projectKey: 'TEST',
      repositorySlug: 'testrepo',
      path: '.proviso.yml',
    };
    bitbucket.repos.getContent(req, function(err, content) {
      should.not.exist(err);

      content.should.be.a.String;
      return done(err);
    });
  });

  it('getContent of a directory', function(done) {
    var req = {
      projectKey: 'TEST',
      repositorySlug: 'testrepo',
    };
    bitbucket.repos.getContent(req, function(err, files) {
      should.not.exist(err);

      // console.log(JSON.stringify(files, null, 2))

      files.should.be.an.Array;
      files.length.should.be.above(0);
      return done(err);
    });
  });
});

describe('statuses', function() {
  it('create', function(done) {

    var status = {
      state: 'SUCCESSFUL',
      key: 'build',
      name: 'builder',
      url: 'https://probo.ci/builds/akljf',
      description: 'build succeeded',
    };

    var ref = '5c60c419242643c101f334ea104f23887ddb560a';

    bitbucket.statuses.create(status, {ref: ref}, function(err) {
      should.not.exist(err);
      done(err);
    });
  });

});
*/