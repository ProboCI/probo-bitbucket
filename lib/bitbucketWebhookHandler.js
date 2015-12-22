'use strict';

var EventEmitter = require('events').EventEmitter;

module.exports = function(options) {
  // make it an EventEmitter, sort of
  Object.setPrototypeOf(handler, EventEmitter.prototype);
  EventEmitter.call(handler);

  return handler;

  // handles all incoming bb messages
  function handler(req, res, cb) {
    var payload = req.body;

    /*
     * There are three BB event types:
     *  pullrequest:updated
     *  pullrequest:created
     *  repo:push
     */
    // this is how we know what kind of event we're dealing with
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
