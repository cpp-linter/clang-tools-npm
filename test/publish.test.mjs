import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../scripts/publish.mjs';
import { fakeCommand, mockFetch, setEnv, tempDir } from './helpers.mjs';

const PUBLISH_SCRIPT = fileURLToPath(new URL('../scripts/publish.mjs', import.meta.url));

/** A dist folder as build.mjs leaves it, for LLVM 23 (latest) and 22. */
function makeDist(t) {
  const dist = tempDir(t);
  const release = (major, version, dist_tag) => ({
    major,
    version,
    release: `llvm-${version}`,
    dist_tag,
    packages: [
      { name: '@cpp-linter/clang-tidy-linux-x64', tarball: `tarballs/cpp-linter-clang-tidy-linux-x64-${version}.tgz` },
      { name: '@cpp-linter/clang-tidy', tarball: `tarballs/cpp-linter-clang-tidy-${version}.tgz` },
    ],
  });
  fs.writeFileSync(
    path.join(dist, 'manifest.json'),
    JSON.stringify({ latest_major: '23', versions: [release('23', '23.1.3', 'latest'), release('22', '22.1.8', 'llvm-22')] }),
  );
  return dist;
}

test('publishes what is not on npm yet, in order, with the dist-tag of its version', async (t) => {
  const dist = makeDist(t);
  const npm = fakeCommand(t, 'npm');
  setEnv(t, 'GITHUB_ACTIONS', undefined);
  // the platform package of 23.1.3 was published by an earlier, failed run
  mockFetch(t, (url) => new Response('{}', { status: url.endsWith('clang-tidy-linux-x64/23.1.3') ? 200 : 404 }));
  const log = t.mock.method(console, 'log', () => {}).mock;

  await main(['--dist', dist]);

  const tarball = (name) => path.join(dist, 'tarballs', name);
  assert.deepEqual(npm(), [
    `publish ${tarball('cpp-linter-clang-tidy-23.1.3.tgz')} --access public --tag latest`,
    `publish ${tarball('cpp-linter-clang-tidy-linux-x64-22.1.8.tgz')} --access public --tag llvm-22`,
    `publish ${tarball('cpp-linter-clang-tidy-22.1.8.tgz')} --access public --tag llvm-22`,
  ]);
  const lines = log.calls.map((call) => call.arguments.join(' '));
  assert.equal(lines[0], '@cpp-linter/clang-tidy-linux-x64@23.1.3 is already on npm, skipped.');
  assert.equal(lines.at(-1), 'Published 3 package(s).');
});

test('adds provenance in GitHub Actions and passes --dry-run on', async (t) => {
  const dist = makeDist(t);
  const npm = fakeCommand(t, 'npm');
  setEnv(t, 'GITHUB_ACTIONS', 'true');
  mockFetch(t, () => new Response('{}', { status: 404 }));
  const log = t.mock.method(console, 'log', () => {}).mock;

  await main(['--dist', dist, '--dry-run']);

  assert.equal(npm().length, 4);
  assert.ok(npm().every((call) => call.endsWith(' --provenance --dry-run')), npm().join('\n'));
  assert.equal(log.calls.at(-1).arguments[0], 'Would publish 4 package(s).');
});

test('stops at the first package that npm fails to publish', async (t) => {
  const dist = makeDist(t);
  const npm = fakeCommand(t, 'npm', 'exit 1');
  mockFetch(t, () => new Response('{}', { status: 404 }));
  t.mock.method(console, 'log', () => {});
  await assert.rejects(main(['--dist', dist]), /Command failed: npm publish/);
  assert.equal(npm().length, 1);
});

test('the publish script reports errors and exits with 1', (t) => {
  const dist = tempDir(t);
  assert.throws(
    () => execFileSync(process.execPath, [PUBLISH_SCRIPT, '--dist', dist], { stdio: 'pipe' }),
    (error) => {
      assert.equal(error.status, 1);
      assert.match(error.stderr.toString(), /^ENOENT: no such file or directory, open '.*manifest\.json'\n$/);
      return true;
    },
  );
});
