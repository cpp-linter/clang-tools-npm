import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { fillTemplate, isPublished, main, PLATFORMS } from '../scripts/build.mjs';
import {
  fakeCommand,
  makeRelease,
  mockFetch,
  serve,
  setEnv,
  tarGz,
  tempDir,
  withoutDelays,
} from './helpers.mjs';

const BUILD_SCRIPT = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));

/** Writes index.json into a temp dir and returns the build's --index/--out/--cache arguments. */
function workspace(t, index) {
  const dir = tempDir(t);
  const indexFile = path.join(dir, 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify(index));
  const out = path.join(dir, 'dist');
  const cache = path.join(dir, 'cache');
  return { dir, out, cache, args: ['--index', indexFile, '--out', out, '--cache', cache] };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Silences console.log for one test and returns what was logged. */
function captureLog(t) {
  return t.mock.method(console, 'log', () => {}).mock;
}

function logged(log) {
  return log.calls.map((call) => call.arguments.join(' ')).join('\n');
}

test('isPublished asks the registry for one version of a package', async (t) => {
  const calls = mockFetch(t, (url) => new Response('{}', { status: url.endsWith('/23.1.3') ? 200 : 404 }));
  assert.equal(await isPublished('@cpp-linter/clang-tidy', '23.1.3'), true);
  assert.equal(await isPublished('@cpp-linter/clang-tidy', '22.1.0'), false);
  assert.deepEqual(calls, [
    'https://registry.npmjs.org/@cpp-linter%2Fclang-tidy/23.1.3',
    'https://registry.npmjs.org/@cpp-linter%2Fclang-tidy/22.1.0',
  ]);
});

test('isPublished retries server and network errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const answers = [new Error('ECONNRESET'), new Response('', { status: 502 }), new Response('{}')];
  const calls = mockFetch(t, () => {
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  });
  assert.equal(await withoutDelays(t, isPublished('@cpp-linter/clang-tidy', '23.1.3')), true);
  assert.equal(calls.length, 3);
});

test('isPublished gives up after 4 attempts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = mockFetch(t, () => new Response('', { status: 503 }));
  await assert.rejects(
    withoutDelays(t, isPublished('@cpp-linter/clang-tidy', '23.1.3')),
    /GET https:\/\/registry\.npmjs\.org\/@cpp-linter%2Fclang-tidy\/23\.1\.3: HTTP 503/,
  );
  assert.equal(calls.length, 4);

  calls.length = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    throw new Error('getaddrinfo ENOTFOUND');
  });
  await assert.rejects(withoutDelays(t, isPublished('@cpp-linter/clang-tidy', '23.1.3')), /ENOTFOUND/);
  assert.equal(calls.length, 4);
});

test('fillTemplate fails on a placeholder without a value', () => {
  assert.throws(() => fillTemplate('platform-README.md', {}), /platform-README\.md: no value for \{\{NAME\}\}/);
});

test('main packs every tool for every platform', async (t) => {
  const { index, assets } = makeRelease(t);
  const { out, args } = workspace(t, index);
  const outputFile = path.join(tempDir(t), 'github-output');
  setEnv(t, 'GITHUB_OUTPUT', outputFile);
  const fetched = mockFetch(t, serve(assets));
  const log = captureLog(t);

  await main(['--versions', '23', ...args]);

  const manifest = readJson(path.join(out, 'manifest.json'));
  assert.equal(manifest.latest_major, '23');
  assert.equal(manifest.index_generated_at, index.generated_at);
  assert.equal(manifest.versions.length, 1);
  const [release] = manifest.versions;
  assert.deepEqual(
    { major: release.major, version: release.version, release: release.release, dist_tag: release.dist_tag },
    { major: '23', version: '23.1.3', release: 'llvm-23.1.3', dist_tag: 'latest' },
  );
  // per tool: the 6 platform packages first, then the main package
  assert.deepEqual(
    release.packages.map((p) => p.name),
    ['clang-format', 'clang-tidy'].flatMap((tool) => [
      ...PLATFORMS.map((p) => `@cpp-linter/${tool}-${p.os}-${p.cpu}`),
      `@cpp-linter/${tool}`,
    ]),
  );
  for (const pkg of release.packages) {
    assert.match(pkg.tarball, /^tarballs\/cpp-linter-.*-23\.1\.3\.tgz$/);
    assert.ok(fs.existsSync(path.join(out, pkg.tarball)), pkg.tarball);
  }

  // a platform package: the binary, its license, and (for clang-tidy) the headers
  const tidyDir = path.join(out, 'packages', '23.1.3', 'clang-tidy-win32-arm64');
  const tidyPkg = readJson(path.join(tidyDir, 'package.json'));
  assert.equal(tidyPkg.name, '@cpp-linter/clang-tidy-win32-arm64');
  assert.deepEqual([tidyPkg.os, tidyPkg.cpu], [['win32'], ['arm64']]);
  assert.deepEqual(tidyPkg.files, ['bin', 'LICENSE.TXT', 'lib']);
  assert.equal(tidyPkg.staticBinary.url, index.versions[23].tools['clang-tidy']['windows-arm64'].url);
  assert.equal(fs.readFileSync(path.join(tidyDir, 'bin', 'clang-tidy.exe'), 'utf8'), 'clang-tidy for windows-arm64');
  assert.ok(fs.existsSync(path.join(tidyDir, 'lib', 'clang', '23', 'include', 'stddef.h')));
  assert.match(fs.readFileSync(path.join(tidyDir, 'README.md'), 'utf8'), /@cpp-linter\/clang-tidy-win32-arm64/);

  const formatDir = path.join(out, 'packages', '23.1.3', 'clang-format-linux-x64');
  const formatPkg = readJson(path.join(formatDir, 'package.json'));
  assert.deepEqual(formatPkg.files, ['bin', 'LICENSE.TXT']);
  assert.equal(fs.statSync(path.join(formatDir, 'bin', 'clang-format')).mode & 0o777, 0o755);
  assert.ok(!fs.existsSync(path.join(formatDir, 'lib')));

  // the main package lists every platform package at the same version
  const mainDir = path.join(out, 'packages', '23.1.3', 'clang-tidy');
  const mainPkg = readJson(path.join(mainDir, 'package.json'));
  assert.deepEqual(mainPkg.bin, { 'clang-tidy': 'bin/clang-tidy.js' });
  assert.deepEqual(Object.values(mainPkg.optionalDependencies), Array(6).fill('23.1.3'));
  assert.ok(fs.existsSync(path.join(mainDir, 'index.js')));
  assert.ok(!fs.readFileSync(path.join(mainDir, 'README.md'), 'utf8').includes('{{'));

  // the license and the headers are downloaded once, not once per package
  assert.equal(fetched.filter((url) => url.endsWith('/LICENSE.TXT')).length, 1);
  assert.equal(fetched.filter((url) => url.endsWith('.tar.gz')).length, 1);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'has-packages=true\nversions=["23"]\n');
  assert.match(logged(log), /LLVM 23\.1\.3 \(llvm-23\.1\.3, dist-tag latest\): clang-format, clang-tidy/);
});

test('main reuses verified downloads and checks attestations once per file', async (t) => {
  const { index, assets } = makeRelease(t);
  const { cache, args } = workspace(t, index);
  const gh = fakeCommand(t, 'gh');
  captureLog(t);
  const fetched = mockFetch(t, serve(assets));

  await main(['--tools', 'clang-format', '--verify-attestations', ...args]);
  // the license and the 6 binaries
  assert.equal(fetched.length, 7);
  assert.equal(gh().length, 7);
  assert.ok(gh().every((call) => call.startsWith('attestation verify ') && call.endsWith(' --repo cpp-linter/clang-tools-static-binaries')));

  // a second build uses the cache; a corrupted cached file is downloaded again
  fs.writeFileSync(path.join(cache, 'llvm-23.1.3', 'LICENSE.TXT'), 'tampered');
  fetched.length = 0;
  await main(['--tools', 'clang-format', ...args]);
  assert.deepEqual(fetched, [index.versions[23].license.url]);
  assert.equal(fs.readFileSync(path.join(cache, 'llvm-23.1.3', 'LICENSE.TXT'), 'utf8'), 'Apache-2.0 WITH LLVM-exception');
});

test('main rejects downloads that do not match index.json', async (t) => {
  const { index, assets } = makeRelease(t);
  const license = index.versions[23].license;
  captureLog(t);

  for (const [data, error] of [
    [Buffer.from('short'), /LICENSE\.TXT: got 5 bytes, index\.json says 30\./],
    [Buffer.from('Apache-2.0 WITH LLVM-exceptioN'), /LICENSE\.TXT: sha512 [0-9a-f]+ does not match index\.json/],
  ]) {
    const { args } = workspace(t, index);
    assets.set(license.url, data);
    t.mock.method(globalThis, 'fetch', serve(assets));
    await assert.rejects(main(args), error);
  }

  const { args } = workspace(t, index);
  assets.delete(license.url);
  t.mock.method(globalThis, 'fetch', serve(assets));
  await assert.rejects(main(args), new RegExp(`GET ${license.url}: HTTP 404`));
});

test('main loads index.json over HTTP', async (t) => {
  const { index, assets } = makeRelease(t);
  const { out, args } = workspace(t, index);
  const url = 'https://index.invalid/index.json';
  assets.set(url, JSON.stringify(index));
  setEnv(t, 'GITHUB_OUTPUT', undefined);
  captureLog(t);
  mockFetch(t, serve(assets));
  await main([...args, '--index', url, '--tools', 'clang-format']);
  assert.equal(readJson(path.join(out, 'manifest.json')).versions.length, 1);

  await assert.rejects(
    main([...args, '--index', 'https://index.invalid/missing.json']),
    /GET https:\/\/index\.invalid\/missing\.json: HTTP 404/,
  );
});

test('main refuses unknown tools and index.json schemas', async (t) => {
  const { index } = makeRelease(t);
  const { args } = workspace(t, index);
  await assert.rejects(main([...args, '--tools', 'clang-format,clangd']), /Unknown tool clangd; known: clang-format, clang-tidy/);

  const { args: v2Args } = workspace(t, { ...index, schema_version: 2 });
  await assert.rejects(main(v2Args), /index\.json schema_version 2 is not supported\./);
});

test('main with --only-missing packs only what is not on npm', async (t) => {
  const { index, assets } = makeRelease(t);
  const { out, args } = workspace(t, index);
  const outputFile = path.join(tempDir(t), 'github-output');
  setEnv(t, 'GITHUB_OUTPUT', outputFile);
  const log = captureLog(t);

  // everything is published: nothing to pack
  mockFetch(t, serve(assets, { published: () => true }));
  await main(['--only-missing', ...args]);
  assert.deepEqual(readJson(path.join(out, 'manifest.json')).versions, []);
  assert.match(logged(log), /LLVM 23\.1\.3: already on npm, skipped\./);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'has-packages=false\nversions=[]\n');

  // one platform package of clang-tidy is missing: clang-tidy is packed again
  t.mock.method(globalThis, 'fetch', serve(assets, { published: (url) => !url.includes('clang-tidy-darwin-x64') }));
  await main(['--only-missing', ...args]);
  const [release] = readJson(path.join(out, 'manifest.json')).versions;
  assert.deepEqual([...new Set(release.packages.map((p) => p.tool))], ['clang-tidy']);
});

test('a release without a license fails a named version and is skipped by "all"', async (t) => {
  const { index, assets } = makeRelease(t);
  delete index.versions[23].license;
  const { out, args } = workspace(t, index);
  mockFetch(t, serve(assets));
  const log = captureLog(t);

  await assert.rejects(main(['--versions', '23', ...args]), /LLVM 23\.1\.3: llvm-23\.1\.3 has no LICENSE\.TXT/);

  setEnv(t, 'GITHUB_ACTIONS', undefined);
  await main(['--versions', 'all', ...args]);
  assert.deepEqual(readJson(path.join(out, 'manifest.json')).versions, []);
  assert.match(logged(log), /^ {2}LLVM 23\.1\.3: .* Skipped\.$/m);

  setEnv(t, 'GITHUB_ACTIONS', 'true');
  await main(['--versions', 'all', ...args]);
  assert.match(logged(log), /^::warning::LLVM 23\.1\.3: .* Skipped\.$/m);
});

test('a release without headers fails clang-tidy, or skips only clang-tidy with "all"', async (t) => {
  const { index, assets } = makeRelease(t);
  delete index.versions[23].resource_headers;
  const { out, args } = workspace(t, index);
  mockFetch(t, serve(assets));
  const log = captureLog(t);

  await assert.rejects(main(args), /LLVM 23\.1\.3: llvm-23\.1\.3 has no clang resource headers yet/);

  for (const actions of [undefined, 'true']) {
    setEnv(t, 'GITHUB_ACTIONS', actions);
    await main(['--versions', 'all', ...args]);
    const [release] = readJson(path.join(out, 'manifest.json')).versions;
    assert.deepEqual([...new Set(release.packages.map((p) => p.tool))], ['clang-format']);
  }
  assert.match(logged(log), /^ {2}LLVM 23\.1\.3: .*could not find stddef\.h.* Skipped\.$/m);
  assert.match(logged(log), /^::warning::LLVM 23\.1\.3: .*could not find stddef\.h.* Skipped\.$/m);

  // only clang-tidy needs the headers: with clang-format alone, nothing is packed
  log.resetCalls();
  await main(['--versions', 'all', '--tools', 'clang-tidy', ...args]);
  assert.deepEqual(readJson(path.join(out, 'manifest.json')).versions, []);
});

test('main fails when index.json lacks a tool or a platform', async (t) => {
  const { index, assets } = makeRelease(t);
  mockFetch(t, serve(assets));
  captureLog(t);

  const noTool = structuredClone(index);
  delete noTool.versions[23].tools['clang-tidy'];
  await assert.rejects(main(workspace(t, noTool).args), /LLVM 23\.1\.3: index\.json has no clang-tidy\./);

  const noPlatform = structuredClone(index);
  delete noPlatform.versions[23].tools['clang-format']['macos-arm64'];
  await assert.rejects(main(workspace(t, noPlatform).args), /LLVM 23\.1\.3: no clang-format for macos-arm64\./);
});

test('main checks the headers archive before unpacking it', async (t) => {
  captureLog(t);
  for (const [files, error] of [
    [{ 'lib/clang/23/include/stddef.h': '', 'etc/profile': '' }, /Unexpected entry in clang-resource-headers-23\.tar\.gz: etc\//],
    [{ 'lib/other/stddef.h': '' }, /Unexpected entry in clang-resource-headers-23\.tar\.gz: lib\/other\//],
    [{ 'lib/clang/23/include/stdint.h': '' }, /clang-resource-headers-23\.tar\.gz has no lib\/clang\/<version>\/include\/stddef\.h/],
  ]) {
    const { index, assets } = makeRelease(t, { headers: tarGz(t, files) });
    t.mock.method(globalThis, 'fetch', serve(assets));
    await assert.rejects(main([...workspace(t, index).args, '--tools', 'clang-tidy']), error);
  }
});

test('the build script reports errors and exits with 1', (t) => {
  const { dir } = workspace(t, {});
  assert.throws(
    () => execFileSync(process.execPath, [BUILD_SCRIPT, '--tools', 'clangd'], { cwd: dir, stdio: 'pipe' }),
    (error) => {
      assert.equal(error.status, 1);
      assert.equal(error.stderr.toString(), 'Unknown tool clangd; known: clang-format, clang-tidy\n');
      return true;
    },
  );
});
