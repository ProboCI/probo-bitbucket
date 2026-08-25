'use strict';

var EventEmitter = require('events').EventEmitter;

class BitbucketWebhook extends EventEmitter {

  constructor(options) {
    super(options);
    options = options || {};
    this.log = options.log || null;
    // Track last-built commit hash per PR to avoid rebuilding on non-code updates
    // (e.g. adding reviewers, editing description). Key: "owner/repo#prId"
    this.prCommitHashes = {};
  }

  handle(req, res, cb) {
    var self = this;
    var payload = req.body;
    var log = this.log || req.log;

    /*
     * There are three BB event types:
     *  pullrequest:updated
     *  pullrequest:created
     *  repo:push
     */
    var eventType = req.headers['x-event-key'];

    var pr = payload && payload.pullrequest;
    var slug = payload && payload.repository && payload.repository.full_name;
    var isPrBuildEvent = eventType === 'pullrequest:created' || eventType === 'pullrequest:updated';
    var sha = isPrBuildEvent && pr && pr.source && pr.source.commit && pr.source.commit.hash;
    var prKey = sha && slug ? slug + '#' + pr.id : null;

    // For PR updates, only emit if the source commit hash has changed.
    // This filters out non-code events like adding reviewers or editing descriptions.
    if (eventType === 'pullrequest:updated' && prKey && this.prCommitHashes[prKey] === sha) {
      log.info({pullRequest: prKey, sha: sha},
        'Skipping pullrequest:updated, commit hash unchanged since the last build');
      res.json({ok: true});
      return cb();
    }

    var emitData = {
      event: eventType,
      payload: payload,
      protocol: req.method,
      host: req.headers.host,
      hookId: req.headers['x-hook-uuid'],
    };

    if (prKey) {
      // Claim the hash before the build is submitted so a burst of duplicate
      // deliveries for the same push only builds once. The claim is released
      // below if the build never made it, otherwise a build that died on an
      // expired token (or any other transient failure) would be skipped forever
      // and redelivering the webhook would do nothing.
      var previousSha = this.prCommitHashes[prKey];
      this.prCommitHashes[prKey] = sha;

      this.emit(eventType, emitData, function(error, build) {
        if (!error && build) {
          return;
        }

        if (self.prCommitHashes[prKey] === sha) {
          if (previousSha) {
            self.prCommitHashes[prKey] = previousSha;
          }
          else {
            delete self.prCommitHashes[prKey];
          }
        }

        log.warn({err: error, pullRequest: prKey, sha: sha},
          'Build was not submitted, releasing commit hash so a redelivery can retry');
      });
    }
    else {
      this.emit(eventType, emitData);
    }

    res.json({ok: true});

    cb();
  }
}

module.exports = BitbucketWebhook;
