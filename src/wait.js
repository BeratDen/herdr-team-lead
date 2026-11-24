import fs from 'node:fs';
import path from 'node:path';
import { validateName } from './names.js';
import { TEAM_DIR, defaultSleep, screenTail, workerPath } from './task.js';

const STILL_WORKING = 'hâlâ çalışıyor';

// Polls every worker until all are done, one needs the lead's attention (blocked, or idle without a result),
// or the time slice runs out. "Done" is the agent not working AND result.md present: herdr's status alone is not trusted.
export function waitForTasks({
  repoRoot, config, names, herdr,
  timeoutMs = 540000, pollMs = 2000, idleMs = 60000, now = Date.now, sleep = defaultSleep,
}) {
  if (!Array.isArray(names) || names.length === 0) throw new Error('en az bir ad verin');
  names.forEach(validateName);
  if (new Set(names).size !== names.length) throw new Error('aynı ad tekrar verilmiş');

  const started = now();
  const state = {}; // name -> { state, detail? } once final
  const idleSince = {};

  for (;;) {
    for (const name of names) {
      if (state[name]?.state === 'done') continue;
      const { status } = herdr.getAgent({ name });
      if (status === 'blocked') {
        state[name] = { state: 'blocked', detail: screenTail(herdr.readAgent({ name, lines: 20 }), 20) };
        continue;
      }
      if (status === 'working') {
        delete idleSince[name];
        continue;
      }
      idleSince[name] ??= now();
      if (fs.existsSync(path.join(workerPath(repoRoot, config, name), TEAM_DIR, 'result.md'))) {
        state[name] = { state: 'done' };
      } else if (now() - idleSince[name] >= idleMs) {
        state[name] = { state: 'idle_without_result', detail: screenTail(herdr.readAgent({ name, lines: 20 }), 20) };
      }
    }

    const agents = names.map((name) => ({ name, ...(state[name] ?? { state: 'timeout', detail: STILL_WORKING }) }));
    if (agents.some((a) => a.state === 'blocked' || a.state === 'idle_without_result')) return { agents, exitCode: 2 };
    if (agents.every((a) => a.state === 'done')) return { agents, exitCode: 0 };
    if (now() - started >= timeoutMs) return { agents, exitCode: 4 };
    sleep(pollMs);
  }
}
