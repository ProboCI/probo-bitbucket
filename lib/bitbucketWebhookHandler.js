'use strict';

var EventEmitter = require('events').EventEmitter;


// handler.on('error', this.errorHandler);
// handler.on('push', this.pushHandler);

module.exports = function(options) {
//  util.inherits(handler, EventEmitter);
  // make it an EventEmitter, sort of
  handler.__proto__ = EventEmitter.prototype;
  EventEmitter.call(handler);

  return handler;

  function handler(req, res, cb) {
    var payload = req.body;

    /*
     * We listen for two event types:
     *  pullrequest:updated
     *  pullrequest:created
     */
    var eventType = req.headers['x-event-key'];

    var emitData = {
      event: eventType,
      payload: payload,
      protocol: req.method,
      host: req.headers.host,
      hookId: req.headers['x-hook-uuid'],
    };

    handler.emit(eventType, emitData);

    res.json({ok: true});

    cb();
  }
};
