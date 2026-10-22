// Shared fixtures for the unit tests: a fake static-binaries release, a fake
// npm registry (a mocked global fetch) and fake command line tools on PATH.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';

import { PLATFORMS, TOOLS } from '../scripts/build.mjs';

export const BASE_URL = 'https://downloads.invalid/llvm-23.1.3';

export function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clang-tools-npm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function asset(name, data) {
  return {
    name,
    url: `${BASE_URL}/${name}`,
    size: data.length,
    sha512: createHash('sha512').update(data).digest('hex'),
    data,
  };
}

/** Packs `files` ({ "lib/clang/23/include/stddef.h": "..." }) as a .tar.gz. */
export function tarGz(t, files) {
  const dir = tempDir(t);
  const src = path.join(dir, 'src');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
    fs.writeFileSync(path.join(src, name), text);
  }
  const archive = path.join(dir, 'archive.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', src, ...Object.keys(files)]);
  return fs.readFileSync(archive);
}

/**
 * A release of LLVM 23 as index.json lists it, with every file it points at.
 * `assets` maps each url to its bytes, for the fake fetch.
 */
export function makeRelease(t, { headers } = {}) {
  const assets = new Map();
  const add = (name, data) => {
    const entry = asset(name, Buffer.from(data));
    assets.set(entry.url, entry.data);
    const { data: _, ...listed } = entry;
    return listed;
  };
  const tools = {};
  for (const tool of Object.keys(TOOLS)) {
    tools[tool] = {};
    for (const platform of PLATFORMS) {
      const exe = platform.os === 'win32' ? '.exe' : '';
      tools[tool][platform.source] = add(`${tool}-23_${platform.source}${exe}`, `${tool} for ${platform.source}`);
    }
  }
  const entry = {
    version: '23.1.3',
    tag: 'llvm-23.1.3',
    license: add('LICENSE.TXT', 'Apache-2.0 WITH LLVM-exception'),
    resource_headers: add(
      'clang-resource-headers-23.tar.gz',
      headers ?? tarGz(t, { 'lib/clang/23/include/stddef.h': '/* stddef.h */\n' }),
    ),
    tools,
  };
  const index = {
    schema_version: 1,
    generated_at: '2026-10-22T00:00:00+00:00',
    latest: '23',
    versions: { 23: entry },
  };
  return { index, entry, assets };
}

/**
 * Replaces the global fetch for one test. `handler(url, init)` returns a Response,
 * or throws to simulate a network error. Every call is recorded in `calls`.
 */
export function mockFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init);
  });
  return calls;
}

/** A fetch handler that serves the release's files and answers the registry. */
export function serve(assets, { published = () => false } = {}) {
  return (url) => {
    if (assets.has(url)) return new Response(assets.get(url));
    if (url.startsWith('https://registry.npmjs.org/')) {
      return new Response('{}', { status: published(decodeURIComponent(url)) ? 200 : 404 });
    }
    return new Response('not found', { status: 404 });
  };
}

/**
 * Puts an executable `name` on PATH that appends its arguments, one call per
 * line, to a log file and runs `script` (sh). Returns a function that reads the calls.
 */
export function fakeCommand(t, name, script = 'exit 0') {
  const dir = tempDir(t);
  const log = path.join(dir, `${name}.log`);
  fs.writeFileSync(
    path.join(dir, name),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n${script}\n`,
    { mode: 0o755 },
  );
  const original = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${original}`;
  t.after(() => {
    process.env.PATH = original;
  });
  return () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
}

/** Sets (or, with undefined, removes) an environment variable for one test. */
export function setEnv(t, name, value) {
  const original = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
}

/**
 * Resolves `promise` while mocked timers are on: keeps moving the clock so the
 * retry delays (2 s, 4 s, 8 s) pass without waiting.
 */
export async function withoutDelays(t, promise) {
  let settled = false;
  const tracked = promise.finally(() => {
    settled = true;
  });
  tracked.catch(() => {});
  while (!settled) {
    await nextTurn();
    t.mock.timers.tick(60_000);
  }
  return tracked;
}
