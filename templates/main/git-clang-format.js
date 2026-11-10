#!/usr/bin/env node
'use strict';

const { gitClangFormat } = require('..');

try {
  process.exitCode = gitClangFormat(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
