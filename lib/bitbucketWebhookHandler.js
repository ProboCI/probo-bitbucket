var EventEmitter = require('events').EventEmitter;
var util = require('util');


// handler.on('error', this.errorHandler);
// handler.on('push', this.pushHandler);

module.exports = function(options){
//  util.inherits(handler, EventEmitter);
  // make it an EventEmitter, sort of
  handler.__proto__ = EventEmitter.prototype
  EventEmitter.call(handler)

  return handler;

  function handler(req, res, cb){
     var payload = req.body;

     var emitData = {
       event : req.headers['x-event-key']
     , payload : payload
     , protocol: req.method
     // , host : req.get('host')
     , url : payload.pullrequest.links.html.href
     }

    handler.emit("push", emitData);

    res.json({ok: true});

    cb();
  }
}
