import assert from 'node:assert/strict';
import test from 'node:test';

import { distTag, platformPackageName, PLATFORMS, selectMajors } from '../scripts/build.mjs';

const index = { latest: '23', versions: { 23: {}, 22: {}, 18: {}, 12: {} } };

test('selectMajors picks the newest by default and sorts newest first', () => {
  assert.deepEqual(selectMajors('', index), ['23']);
  assert.deepEqual(selectMajors('latest', index), ['23']);
  assert.deepEqual(selectMajors('12 latest', index), ['23', '12']);
  assert.deepEqual(selectMajors('12,18', index), ['18', '12']);
  assert.deepEqual(selectMajors('all', index), ['23', '22', '18', '12']);
  assert.throws(() => selectMajors('11', index), /LLVM 11 is not in index.json/);
});

test('only the newest major moves the latest dist-tag', () => {
  assert.equal(distTag('23', '23'), 'latest');
  assert.equal(distTag('18', '23'), 'llvm-18');
});

test('platform packages are named after process.platform and process.arch', () => {
  assert.deepEqual(
    PLATFORMS.map((p) => platformPackageName('clang-tidy', p)),
    [
      '@cpp-linter/clang-tidy-linux-x64',
      '@cpp-linter/clang-tidy-linux-arm64',
      '@cpp-linter/clang-tidy-darwin-x64',
      '@cpp-linter/clang-tidy-darwin-arm64',
      '@cpp-linter/clang-tidy-win32-x64',
      '@cpp-linter/clang-tidy-win32-arm64',
    ],
  );
});
