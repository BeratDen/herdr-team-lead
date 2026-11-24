#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHerdr } from './herdr.js';
import { loadConfig } from './config.js';
import { addWorktree } from './add.js';
import { removeWorktree } from './remove.js';
import { sendTask, readResult } from './task.js';
import { waitForTasks } from './wait.js';
import { mergeWorkers } from './merge.js';
import { installSkill } from './skill.js';

const USAGE = `kullanım:
  team worktree add <ad> [--base <ref>] [--agent claude|codex [--prompt <metin>]]
  team worktree remove <ad> [--force] [--merged-into <branch>]
  team task send <ad> (--file <yol> | --text <metin>) [--force]
  team task wait <ad...> [--timeout <sn>]
  team task result <ad>
  team merge <ad...> --into <ad> [--base <ref>]
  team skill install`;

function parseFlags(args, valueFlags, boolFlags) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (valueFlags.includes(a)) {
      if (i + 1 >= args.length) throw new Error(`${a} bir değer gerektirir`);
      flags[a.slice(2)] = args[++i];
    } else if (boolFlags.includes(a)) flags[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new Error(`bilinmeyen seçenek: ${a}`);
    else positional.push(a);
  }
  return { positional, flags };
}

function repoRootOf(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(`git deposu değil: ${cwd}`);
  }
}

function oneName(positional) {
  if (positional.length !== 1) throw new Error(`tam olarak bir ad verin\n${USAGE}`);
  return positional[0];
}

// Each command: the flags it accepts and a handler returning the exit code.
const COMMANDS = {
  'worktree add': {
    values: ['--base', '--agent', '--prompt'],
    bools: [],
    run({ positional, flags, repoRoot, config, herdr, out, err, runCommand }) {
      const r = addWorktree({ repoRoot, name: oneName(positional), base: flags.base, agent: flags.agent, prompt: flags.prompt, herdr, config, runCommand });
      if (!r.ready) {
        err([`HAZIR DEĞİL: ${r.path}`, ...r.problems.map((p) => `  - ${p}`)].join('\n'));
        return 1;
      }
      out(`hazır: ${r.path} (branch ${r.branch})`);
      return 0;
    },
  },
  'worktree remove': {
    values: ['--merged-into'],
    bools: ['--force'],
    run({ positional, flags, repoRoot, config, herdr, out }) {
      const name = oneName(positional);
      const r = removeWorktree({ repoRoot, name, force: !!flags.force, mergedInto: flags['merged-into'], herdr, config });
      out(`kaldırıldı: ${name}${r.removedLinks.length ? ` (bağlar çözüldü: ${r.removedLinks.join(', ')})` : ''}`);
      if (r.branchNote) out(r.branchNote);
      return 0;
    },
  },
  'task send': {
    values: ['--file', '--text'],
    bools: ['--force'],
    run({ positional, flags, repoRoot, config, herdr, out, cwd, sleep, now }) {
      const name = oneName(positional);
      const file = flags.file !== undefined ? path.resolve(cwd, flags.file) : undefined;
      const r = sendTask({ repoRoot, config, name, file, text: flags.text, force: !!flags.force, herdr, sleep, now });
      out(`görev gönderildi: ${name} (${r.taskPath})`);
      return 0;
    },
  },
  'task wait': {
    values: ['--timeout'],
    bools: [],
    run({ positional, flags, repoRoot, config, herdr, out, sleep, now }) {
      let timeoutMs;
      if (flags.timeout !== undefined) {
        const sec = Number(flags.timeout);
        if (!Number.isFinite(sec) || sec <= 0) throw new Error('--timeout pozitif bir sayı (saniye) olmalı');
        timeoutMs = sec * 1000;
      }
      const r = waitForTasks({ repoRoot, config, names: positional, herdr, timeoutMs, sleep, now });
      for (const a of r.agents) {
        out([`${a.name}: ${a.state}`, ...(a.detail ? a.detail.split('\n').map((l) => `  ${l}`) : [])].join('\n'));
      }
      return r.exitCode;
    },
  },
  'skill install': {
    values: [],
    bools: [],
    noRepo: true,
    run({ skillsDir, out }) {
      out(`kuruldu: ${installSkill({ skillsDir }).dest}`);
      return 0;
    },
  },
  merge: {
    values: ['--into', '--base'],
    bools: [],
    run({ positional, flags, repoRoot, config, herdr, out, runCommand }) {
      if (flags.into === undefined) throw new Error(`--into <entegrasyon-adı> gerekli\n${USAGE}`);
      const r = mergeWorkers({ repoRoot, config, names: positional, into: flags.into, base: flags.base, herdr, runCommand });
      const lines = [`entegrasyon: ${r.integrationPath} (branch ${flags.into})`];
      if (r.merged.length) lines.push(`birleşti: ${r.merged.join(', ')}`);
      for (const s of r.skipped) lines.push(`UYARI atlandı: ${s.name} (${s.reason})`);
      for (const c of r.committed) lines.push(`otomatik commit (${c.name} commit edemedi): ${c.files.join(', ')}`);
      if (r.status === 'conflict') {
        lines.push(`ÇAKIŞMA (${r.conflictWorker}): ${r.conflicts.join(', ')}`);
        lines.push(`Çakışmaları ${r.integrationPath} içinde çöz, commit et, aynı komutu yeniden çalıştır.`);
      }
      if (r.status === 'tests_failed') lines.push(`TEST BAŞARISIZ (birleştirme tamam): ${r.testError}`);
      out(lines.join('\n'));
      return { merged: 0, conflict: 3, tests_failed: 5 }[r.status];
    },
  },
  'task result': {
    values: [],
    bools: [],
    run({ positional, repoRoot, config, out }) {
      out(readResult({ repoRoot, config, name: oneName(positional) }));
      return 0;
    },
  },
};

export function main(argv, {
  cwd = process.cwd(), herdr, out = console.log, err = console.error, runCommand, sleep, now,
  skillsDir = path.join(os.homedir(), '.claude', 'skills'),
} = {}) {
  const twoWord = COMMANDS[`${argv[0]} ${argv[1]}`];
  const command = twoWord ?? COMMANDS[argv[0]];
  if (!command) {
    err(USAGE);
    return 1;
  }
  const rest = argv.slice(twoWord ? 2 : 1);
  try {
    const { positional, flags } = parseFlags(rest, command.values, command.bools);
    if (command.noRepo) return command.run({ positional, flags, out, err, cwd, skillsDir });
    const repoRoot = path.resolve(repoRootOf(cwd));
    const config = loadConfig(repoRoot);
    return command.run({ positional, flags, repoRoot, config, herdr: herdr ?? createHerdr(), out, err, cwd, runCommand, sleep, now });
  } catch (e) {
    err(e.message);
    return 1;
  }
}

// Compare real paths: a global shim (npm link) runs this file through a link to the repo.
function isEntryPoint() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && isEntryPoint()) {
  process.exit(main(process.argv.slice(2)));
}
