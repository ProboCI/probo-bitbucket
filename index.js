/* eslint no-process-exit: 0 */
'use strict';

var path = require('path');
var util = require('util');

var Loader = require('yaml-config-loader');
var yargs = require('yargs');
var loader = new Loader();

loader.on('error', function(error) {
  if (error.name === 'YAMLException') {
    console.error({err: error}, util.print('Error parsing YAML file `', error.filePath, '`:', error.reason));
  }
  throw error;
});

var argv = yargs
  .describe('port', 'The port to listen on.')
  .alias('port', 'p')
  .describe('config', 'A YAML config file or directory of yaml files to load, can be invoked multiple times and later files will override earlier.')
  .alias('config', 'c')
  .describe('help', 'Display this help message.')
  .alias('help', 'h');

argv = yargs.argv;

if (argv.help) {
  yargs.showHelp();
  process.exit();
}

loader.add(path.resolve(path.join(__dirname, 'defaults.yaml')), {allowedKeys: true});
loader.addAndNormalizeObject(process.env);

if (argv.config) {
  if (typeof argv.config === 'string') {
    argv.config = [argv.config];
  }
  for (let filePath of argv.config) {
    loader.add(path.resolve(filePath));
  }
}

var executor = require('./handler');

if (executor.options) {
  yargs = executor.options(yargs);
  loader.addAndNormalizeObject(yargs.argv);
}


loader.load(function(error, config) {
  if (error) throw error;
  if (executor.configure) {
    executor.configure(config);
  }
  executor.run();
});
