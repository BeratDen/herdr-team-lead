import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installSkill, PACKAGED_SKILL } from '../src/skill.js';
import { makeTmp } from './helpers.js';

test('installSkill copies SKILL.md under herdr-team-lead', () => {
  const skillsDir = makeTmp('ht-skills-');
  const { dest } = installSkill({ skillsDir });
  assert.equal(dest, path.join(skillsDir, 'herdr-team-lead'));
  assert.equal(
    fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(PACKAGED_SKILL, 'SKILL.md'), 'utf8'),
  );
});

test('installSkill overwrites an older copy', () => {
  const skillsDir = makeTmp('ht-skills-');
  fs.mkdirSync(path.join(skillsDir, 'herdr-team-lead'), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, 'herdr-team-lead', 'SKILL.md'), 'eski');
  installSkill({ skillsDir });
  assert.notEqual(fs.readFileSync(path.join(skillsDir, 'herdr-team-lead', 'SKILL.md'), 'utf8'), 'eski');
});

test('installSkill creates the skills directory when it does not exist', () => {
  const skillsDir = path.join(makeTmp('ht-skills-'), 'not', 'yet');
  installSkill({ skillsDir });
  assert.equal(fs.existsSync(path.join(skillsDir, 'herdr-team-lead', 'SKILL.md')), true);
});

test('the packaged SKILL.md is named herdr-team-lead and covers every team command and exit code', () => {
  const text = fs.readFileSync(path.join(PACKAGED_SKILL, 'SKILL.md'), 'utf8');
  assert.match(text, /^---\r?\nname: herdr-team-lead\r?\ndescription: .+/);
  for (const needle of ['team worktree add', 'team task send', 'team task wait', 'team task result', 'team merge', '--merged-into', '--into']) {
    assert.ok(text.includes(needle), `SKILL.md should mention ${needle}`);
  }
  for (const code of ['4', '2', '3', '5']) assert.ok(new RegExp(`\\b${code}\\b`).test(text), `SKILL.md should explain exit code ${code}`);
});

test('the skill tells the lead to raise the shell timeout for the long-running commands', () => {
  const text = fs.readFileSync(path.join(PACKAGED_SKILL, 'SKILL.md'), 'utf8');
  assert.match(text, /600000/);
});
