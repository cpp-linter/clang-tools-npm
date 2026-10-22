#!/usr/bin/env node
// Publishes the tarballs that build.mjs packed, as listed in dist/manifest.json.
//
//   node scripts/publish.mjs --dist dist [--dry-run]
//
// Versions that are already on npm are skipped, so a failed run can be re-run.
// Platform packages go first and the main package of a tool last, so the main
// package never points at a platform package that does not exist yet. The newest
// LLVM major gets the dist-tag "latest", older ones "llvm-<major>", so publishing
// LLVM 12 does not move `npm install @cpp-linter/clang-tidy` away from the newest.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { isPublished } from './build.mjs';

const { values } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const dist = path.resolve(values.dist);
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));

// In GitHub Actions npm signs a provenance statement that links each
// package to this repository and workflow run.
const provenance = process.env.GITHUB_ACTIONS === 'true' ? ['--provenance'] : [];

let published = 0;
for (const release of manifest.versions) {
  for (const pkg of release.packages) {
    const spec = `${pkg.name}@${release.version}`;
    if (await isPublished(pkg.name, release.version)) {
      console.log(`${spec} is already on npm, skipped.`);
      continue;
    }
    const args = [
      'publish',
      path.join(dist, pkg.tarball),
      '--access',
      'public',
      '--tag',
      release.dist_tag,
      ...provenance,
      ...(values['dry-run'] ? ['--dry-run'] : []),
    ];
    console.log(`>>> npm ${args.join(' ')}`);
    execFileSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    published += 1;
  }
}
console.log(`${values['dry-run'] ? 'Would publish' : 'Published'} ${published} package(s).`);
