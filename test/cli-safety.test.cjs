const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const run = (script, args = [], input = '') => spawnSync(process.execPath,
  ['--require', path.join(__dirname, 'no-network.cjs'), path.join(root, 'scripts', script), ...args],
  { cwd: root, env: {}, input, encoding: 'utf8', timeout: 5000 });

test('simulate and emulator work with networking blocked and no client credentials', () => {
  const simulation = run('simulate-webhook.js');
  assert.equal(simulation.status, 0, simulation.stderr);
  assert.equal(JSON.parse(simulation.stdout).delivered, false);
  const emulator = run('emulator.js', [], '{"id":"fixture-event","chat_id":"fixture-chat","author_id":100,"text":"fixture"}\n');
  assert.equal(emulator.status, 0, emulator.stderr);
  assert.match(emulator.stdout, /"queued":true/);
});

test('legacy URL simulation and implicit cloud discovery are refused without sending', () => {
  assert.equal(run('simulate-webhook.js', ['https://example.invalid/']).status, 1);
  const probe = run('test-live-ping.js');
  assert.equal(probe.status, 1);
  assert.match(probe.stderr, /explicit HTTPS/);
});
