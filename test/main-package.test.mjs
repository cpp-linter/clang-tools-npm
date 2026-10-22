// Tests for the runtime of the main package (templates/main/index.js and bin.js),
// which users run as `clang-tidy` / `clang-format`.
//
// The templates are tested where they are, so coverage is measured on them. Their
// requires are redirected to a fake package: `./package.json` gets a package.json
// written by the test, and `<platform package>/package.json` a fake platform package
// in a temp dir (or "not installed").

import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { tempDir } from './helpers.mjs';

const require = createRequire(import.meta.url);
const INDEX_JS = fileURLToPath(new URL('../templates/main/index.js', import.meta.url));
const BIN_JS = fileURLToPath(new URL('../templates/main/bin.js', import.meta.url));
const KEY = `${process.platform}-${process.arch}`;
const PLATFORM_PACKAGE = `@cpp-linter/clang-tidy-${KEY}`;
const EXE = process.platform === 'win32' ? '.exe' : '';

/**
 * Loads a fresh copy of index.js for a main package with the given package.json.
 * `platformDir` is the installed platform package (undefined: not installed).
 */
function loadIndex(t, { pkg, platformDir }) {
  const load = Module._load;
  const resolve = Module._resolveFilename;
  t.mock.method(Module, '_load', function (request, parent, ...rest) {
    if (parent?.filename === INDEX_JS && request === './package.json') return pkg;
    if (parent?.filename === BIN_JS && request === '..') return load.call(this, INDEX_JS, parent, ...rest);
    return load.call(this, request, parent, ...rest);
  });
  t.mock.method(Module, '_resolveFilename', function (request, parent, ...rest) {
    if (parent?.filename === INDEX_JS && request === `${PLATFORM_PACKAGE}/package.json`) {
      if (platformDir === undefined) {
        throw Object.assign(new Error(`Cannot find module '${request}'`), { code: 'MODULE_NOT_FOUND' });
      }
      return path.join(platformDir, 'package.json');
    }
    return resolve.call(this, request, parent, ...rest);
  });
  delete require.cache[INDEX_JS];
  t.after(() => delete require.cache[INDEX_JS]);
  return require(INDEX_JS);
}

function mainPackageJson(platforms = [KEY, 'win32-arm64']) {
  return {
    name: '@cpp-linter/clang-tidy',
    version: '23.1.3',
    optionalDependencies: Object.fromEntries(platforms.map((p) => [`@cpp-linter/clang-tidy-${p}`, '23.1.3'])),
  };
}

/** A fake platform package whose binary is a shell script. */
function platformPackage(t, script, mode = 0o755) {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: PLATFORM_PACKAGE }));
  const binary = path.join(dir, 'bin', `clang-tidy${EXE}`);
  if (script !== undefined) fs.writeFileSync(binary, `#!/bin/sh\n${script}\n`, { mode });
  return { dir, binary };
}

test('the package describes its tool, version and platforms', (t) => {
  const index = loadIndex(t, { pkg: mainPackageJson() });
  assert.equal(index.tool, 'clang-tidy');
  assert.equal(index.llvmVersion, '23.1.3');
  assert.deepEqual(index.supportedPlatforms, [KEY, 'win32-arm64']);

  const bare = loadIndex(t, { pkg: { name: '@cpp-linter/clang-format', version: '23.1.3' } });
  assert.equal(bare.tool, 'clang-format');
  assert.deepEqual(bare.supportedPlatforms, []);
});

test('binaryPath finds the binary of the installed platform package', (t) => {
  const { dir, binary } = platformPackage(t, 'exit 0');
  const index = loadIndex(t, { pkg: mainPackageJson(), platformDir: dir });
  assert.equal(index.binaryPath(), binary);
});

test('binaryPath explains what is wrong when there is no binary', (t) => {
  const unsupported = loadIndex(t, { pkg: mainPackageJson(['linux-s390x']) });
  assert.throws(
    () => unsupported.binaryPath(),
    new Error(`@cpp-linter/clang-tidy has no clang-tidy binary for ${KEY}. Supported platforms: linux-s390x.`),
  );

  const notInstalled = loadIndex(t, { pkg: mainPackageJson() });
  assert.throws(() => notInstalled.binaryPath(), (error) => {
    assert.match(error.message, new RegExp(`^${PLATFORM_PACKAGE} is not installed\\.`));
    assert.match(error.message, /--omit=optional/);
    assert.match(error.message, new RegExp(`add ${PLATFORM_PACKAGE}@23\\.1\\.3 to your dependencies\\.$`));
    return true;
  });

  const { dir, binary } = platformPackage(t, undefined);
  const missing = loadIndex(t, { pkg: mainPackageJson(), platformDir: dir });
  assert.throws(
    () => missing.binaryPath(),
    new Error(`${PLATFORM_PACKAGE} is installed but ${binary} is missing. Reinstall @cpp-linter/clang-tidy.`),
  );
});

test('run passes the arguments and returns the exit code', (t) => {
  const out = path.join(tempDir(t), 'args');
  const { dir } = platformPackage(t, `printf '%s\\n' "$@" > '${out}'\nexit 3`);
  const index = loadIndex(t, { pkg: mainPackageJson(), platformDir: dir });
  assert.equal(index.run(['--version', 'a b'], { stdio: 'ignore' }), 3);
  assert.equal(fs.readFileSync(out, 'utf8'), '--version\na b\n');
  assert.equal(index.run(), 3);
  // no arguments: printf prints its format once, with an empty argument
  assert.equal(fs.readFileSync(out, 'utf8'), '\n');
});

test('run makes the binary executable when a package manager dropped the bit', (t) => {
  const { dir, binary } = platformPackage(t, 'exit 0', 0o644);
  const index = loadIndex(t, { pkg: mainPackageJson(), platformDir: dir });
  assert.equal(index.run([], { stdio: 'ignore' }), 0);
  assert.equal(fs.statSync(binary).mode & 0o777, 0o755);
});

test('run throws when the binary cannot be started', (t) => {
  // a directory in place of the binary stays not executable after the chmod
  const { dir, binary } = platformPackage(t, undefined);
  fs.mkdirSync(binary);
  const index = loadIndex(t, { pkg: mainPackageJson(), platformDir: dir });
  assert.throws(() => index.run([], { stdio: 'ignore' }), { code: 'EACCES' });
});

test('run passes on the signal that stopped the binary', async (t) => {
  const { dir } = platformPackage(t, 'kill -USR2 $$');
  const index = loadIndex(t, { pkg: mainPackageJson(), platformDir: dir });
  // with a handler, the re-raised signal does not stop this process
  let timer;
  const received = new Promise((resolve, reject) => {
    process.once('SIGUSR2', resolve);
    // also keeps the event loop alive until the signal arrives
    timer = setTimeout(() => reject(new Error('SIGUSR2 was not raised')), 5000);
  });
  assert.equal(index.run([], { stdio: 'ignore' }), 1);
  try {
    assert.equal(await received, 'SIGUSR2');
  } finally {
    clearTimeout(timer);
  }
});

/** Runs bin.js with the given arguments and returns process.exitCode. */
function runBin(t, args) {
  const argv = process.argv;
  process.argv = [process.execPath, BIN_JS, ...args];
  delete require.cache[BIN_JS];
  try {
    require(BIN_JS);
    return process.exitCode;
  } finally {
    process.argv = argv;
    process.exitCode = undefined;
    delete require.cache[BIN_JS];
  }
}

test('the command exits with the exit code of the binary', (t) => {
  const out = path.join(tempDir(t), 'args');
  const { dir } = platformPackage(t, `printf '%s\\n' "$@" > '${out}'\nexit 4`);
  loadIndex(t, { pkg: mainPackageJson(), platformDir: dir });
  assert.equal(runBin(t, ['-p', 'build']), 4);
  assert.equal(fs.readFileSync(out, 'utf8'), '-p\nbuild\n');
});

test('the command prints what is wrong and exits with 1', (t) => {
  loadIndex(t, { pkg: mainPackageJson(['linux-s390x']) });
  const error = t.mock.method(console, 'error', () => {});
  assert.equal(runBin(t, []), 1);
  assert.deepEqual(error.mock.calls[0].arguments, [
    `@cpp-linter/clang-tidy has no clang-tidy binary for ${KEY}. Supported platforms: linux-s390x.`,
  ]);
});
