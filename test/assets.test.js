'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('game response fixtures have the required protocol shape', () => {
  const fixturePath = path.join(root, 'games/sb/responses/index.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  assert.equal(typeof fixture.doInit, 'string');
  assert.ok(Array.isArray(fixture.doSpin));
  assert.ok(fixture.doSpin.length > 0);
  assert.ok(Array.isArray(fixture.doCollect));
  assert.ok(fixture.doCollect.length > 0);
  assert.ok(fixture.doSpin.every(item => typeof item === 'string'));
  assert.ok(fixture.doCollect.every(item => typeof item === 'string'));
});

test('HTML5 loader referenced by the game page exists in the static root', () => {
  const htmlPath = path.join(root, 'games/sb/html5Game.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('./common/js/html5-script-external.js'));

  const loaderPath = path.join(root, 'public/gs2c/common/js/html5-script-external.js');
  assert.equal(fs.existsSync(loaderPath), true);
});
