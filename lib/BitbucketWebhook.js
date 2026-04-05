'use strict';

var EventEmitter = require('events').EventEmitter;

class BitbucketWebhook extends EventEmitter {

  constructor(options) {
    super(options);
    // Track last-seen commit hash per PR to avoid rebuilding on non-code updates
    // (e.g. adding reviewers, editing description). Key: "owner/repo#prId"
    this.prCommitHashes = {};
  }

  handle(req, res, cb) {
    var payload = req.body;

    /*
     * There are three BB event types:
     *  pullrequest:updated
     *  pullrequest:created
     *  repo:push
     */
    var eventType = req.headers['x-event-key'];

    // For PR updates, only emit if the source commit hash has changed.
    // This filters out non-code events like adding reviewers or editing descriptions.
    if (eventType === 'pullrequest:updated' && payload.pullrequest) {
      var pr = payload.pullrequest;
      var sha = pr.source && pr.source.commit && pr.source.commit.hash;
      var slug = payload.repository && payload.repository.full_name;
      var prKey = slug + '#' + pr.id;

      if (sha && this.prCommitHashes[prKey] === sha) {
        // Commit hash hasn't changed — skip this update.
        res.json({ok: true});
        return cb();
      }

      // Store the latest hash for this PR.
      if (sha) {
        this.prCommitHashes[prKey] = sha;
      }
    }

    // For new PRs, store the initial commit hash.
    if (eventType === 'pullrequest:created' && payload.pullrequest) {
      var prCreated = payload.pullrequest;
      var shaCreated = prCreated.source && prCreated.source.commit && prCreated.source.commit.hash;
      var slugCreated = payload.repository && payload.repository.full_name;
      if (shaCreated && slugCreated) {
        this.prCommitHashes[slugCreated + '#' + prCreated.id] = shaCreated;
      }
    }

    var emitData = {
      event: eventType,
      payload: payload,
      protocol: req.method,
      host: req.headers.host,
      hookId: req.headers['x-hook-uuid'],
    };

    this.emit(eventType, emitData);

    res.json({ok: true});

    cb();
  }
}

module.exports = BitbucketWebhook;
