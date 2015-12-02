'use strict';

var nock = require('nock');

var nocker = {
  record: function() {
    nock.recorder.rec({
      output_objects: true,
      dont_print: true,
    });
  },

  stop: function(filename) {
    console.log('writing captured network calls as JSON to', filename);
    var nockCallObjects = nock.recorder.play();
    require('fs').writeFileSync(filename, JSON.stringify(nockCallObjects, null, 2));
  },

  play: function(filename) {
    console.log('loading captured network calls as JSON from', filename);

    return nock.load(filename);
  },
};

module.exports = nocker;
