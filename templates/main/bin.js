#!/usr/bin/env node
'use strict';

const { run } = require('..');

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
