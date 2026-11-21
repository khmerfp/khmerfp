import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('local mock launcher refuses production and staging before environment reset', () => {
  for (const mode of ['production', 'staging']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./custodial-local.js', import.meta.url))], {
      env: { ...process.env, NODE_ENV: mode }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Local mock funding refuses production and staging/);
    assert.doesNotMatch(result.stderr, /Disposable Docker operation failed/);
  }
});
