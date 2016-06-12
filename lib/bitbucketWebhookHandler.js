'use strict';

var EventEmitter = require('events').EventEmitter;

class BitBucketWebhookHandler extends EventEmitter {

  constructor(options) {
    super(options);
  }

  handler(req, res, cb) {
    var payload = req.body;

    /*
     * There are three BB event types:
     *  pullrequest:updated
     *  pullrequest:created
     *  repo:push
     */
    var eventType = req.headers['x-event-key'];

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

module.exports = BitBucketWebhookHandler;
