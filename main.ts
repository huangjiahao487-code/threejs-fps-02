// EMBER LINE — three.js tactical FPS: the entrypoint.
//
// This program hands the game in. It stages a copy of the game's static
// files (game/ and screenshots/) into the grader's output directory and
// writes the dossier.json the judge reads, built with the kit's vendored
// library. It uses only the Node standard library and takes no arguments;
// outside the grader, the MAKEFUN_OUTPUT_DIR environment variable stands
// in for /output (run it with that variable set to the output directory).
//
// The output is deterministic: two runs over the same repository write
// the same bytes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { buildDossier as makeDossier } from './vendor/makefun-threejs.ts';

// Dossier caps from the competition's gate (RULES.txt): the source text
// the judge reads is capped at 160 KiB, at most 4 screenshots of at most
// 256 KiB each, and game/ holds at most 993 entries totalling 48 MiB.
const DOSSIER_TEXT_CAP_BYTES = 163840;
const SCREENSHOT_LIMIT = 4;
const SCREENSHOT_MAX_BYTES = 262144;
const GAME_ENTRY_LIMIT = 993;
const GAME_SIZE_LIMIT_BYTES = 50331648;

// The directory holding this file — the repository root.
function repositoryRoot() {
  return path.dirname(url.fileURLToPath(import.meta.url));
}

// The grader's output directory. Inside the grading container this is
// /output; anywhere else the environment variable overrides it.
function outputDirectory() {
  const override = process.env.MAKEFUN_OUTPUT_DIR;
  if (override === undefined || override === '') {
    return '/output';
  }
  return override;
}

// Copy a whole directory tree, file by file. Anything that is neither a
// plain file nor a directory (a symlink, a socket, ...) stops the run
// instead of being silently skipped, so a broken tree can never hand in
// a partial game.
function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const child of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, child.name);
    const to = path.join(destination, child.name);
    if (child.isDirectory()) {
      copyTree(from, to);
    } else if (child.isFile()) {
      fs.copyFileSync(from, to);
    } else {
      throw new Error(`copyTree: refusing to copy ${from}: not a file or directory`);
    }
  }
}

// Build the dossier from the staged output directory and write it there.
// The caps match the scorer's gate exactly, so this dossier is byte for
// byte the one the gate rebuilds from the same staged files.
function writeDossier(stagedDir) {
  const caps = {
    text_max_bytes: DOSSIER_TEXT_CAP_BYTES,
    screenshots: { max: SCREENSHOT_LIMIT, max_bytes: SCREENSHOT_MAX_BYTES },
    game_max_files: GAME_ENTRY_LIMIT,
    game_max_bytes: GAME_SIZE_LIMIT_BYTES,
  };
  const dossier = makeDossier(stagedDir, caps);
  fs.writeFileSync(path.join(stagedDir, 'dossier.json'), dossier);
  return dossier.length;
}

// Stage game/ and screenshots/, then write the dossier.
function main() {
  const root = repositoryRoot();
  const stagedDir = outputDirectory();

  fs.mkdirSync(stagedDir, { recursive: true });
  copyTree(path.join(root, 'game'), path.join(stagedDir, 'game'));

  const stagedScreenshots = path.join(stagedDir, 'screenshots');
  fs.mkdirSync(stagedScreenshots, { recursive: true });
  const sourceScreenshots = path.join(root, 'screenshots');
  if (fs.existsSync(sourceScreenshots)) {
    copyTree(sourceScreenshots, stagedScreenshots);
  }

  const dossierBytes = writeDossier(stagedDir);
  console.log(`staged ${stagedDir} (dossier.json: ${dossierBytes} bytes)`);
}

main();
