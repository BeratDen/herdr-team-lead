import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateName } from '../src/names.js';

test('validateName returns a valid name unchanged', () => {
  assert.equal(validateName('backend-2'), 'backend-2');
});

for (const bad of ['', 'Back', 'a/b', 'a\\b', '..', 'a..b']) {
  test(`validateName rejects ${JSON.stringify(bad)}`, () => {
    assert.throws(() => validateName(bad), (e) => e instanceof Error && e.message.startsWith('geçersiz ad'));
  });
}
