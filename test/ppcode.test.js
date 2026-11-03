'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ppcode = require('../src/engines/ppcode');

test('PPCode game symbols are restricted to safe Pragmatic identifiers', () => {
  assert.equal(ppcode.safeSymbol('vs20sugarrush'), 'vs20sugarrush');
  assert.throws(() => ppcode.safeSymbol('../etc/passwd'), { message: 'INVALID_GAME' });
  assert.throws(() => ppcode.safeSymbol('vs20sugarrush/../../src'), { message: 'INVALID_GAME' });
});

test('PPCode PHP query placeholders are rendered as escaped HTML values', () => {
  const template = '<p><?php echo $_GET[\'user\']; ?></p><p><?php echo $_GET[\'lang\']; ?></p><p><?php echo $_GET[\'cur\']; ?></p>';
  const html = ppcode.renderTemplate(template, {
    symbol: 'vs20sugarrush',
    user: 'session_123',
    lang: 'pt',
    currency: 'BRL',
  });

  assert.equal(html, '<p>session_123</p><p>pt</p><p>BRL</p>');
  assert.ok(!html.includes('<?php'));
  assert.ok(!html.includes('192.168.10.108'));
});

test('PPCode PHP query placeholders cannot inject HTML', () => {
  const template = '<p><?php echo $_GET[\'user\']; ?></p>';
  const html = ppcode.renderTemplate(template, {
    symbol: 'vs20sugarrush',
    user: '<script>alert(1)</script>',
    lang: 'pt',
    currency: 'BRL',
  });

  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('unknown PHP template directives fail closed', () => {
  assert.throws(
    () => ppcode.renderTemplate('<?php include($_GET[\'file\']); ?>', {
      symbol: 'vs20sugarrush',
      user: 'session_123',
      lang: 'pt',
      currency: 'BRL',
    }),
    { message: 'UNSUPPORTED_GAME_TEMPLATE' }
  );
});

test('embedded private-IP console telemetry is redirected locally', () => {
  const html = ppcode.renderTemplate(
    '<script>var endpoint = "https://192.168.10.108:8000/console.php?";</script>',
    { symbol: 'vs20sugarrush', user: 'session_123', lang: 'pt', currency: 'BRL' }
  );
  assert.ok(html.includes('/__disabled_game_console__?'));
  assert.ok(!html.includes('192.168.10.108'));
});

test('Sugar Rush X v4 wrapper is rebound to local assets and a fresh session key', () => {
  const template = [
    '"datapath":"https://demogamesfree.pragmaticplay.net/hub-demo/common/v2/games-html5/games/vs/vs20sugarrushx/"',
    '"gameService":"https://demogamesfree.pragmaticplay.net/hub-demo/ge/v4/gameService"',
    '"statisticsURL":"https://demogamesfree.pragmaticplay.net/hub-demo/stats.do"',
    '"mgckey":"stylename@generic~SESSION@8f7301d1-7367-462b-8d54-a3dd57c152d8"',
  ].join(',');
  const html = ppcode.renderTemplate(template, {
    symbol: 'vs20sugarrushx',
    user: 'stylename@generic~SESSION@12345678-1234-1234-1234-123456789abc',
    lang: 'pt',
    currency: 'BRL',
  });

  assert.ok(html.includes('/public/vs20sugarrushx/gs2c/common/games-html5/games/vs/vs20sugarrushx/'));
  assert.ok(html.includes('"gameService":"/hub-demo/ge/v4/gameService"'));
  assert.ok(html.includes('"statisticsURL":"/hub-demo/stats.do"'));
  assert.ok(html.includes('/public/vs20sugarrushx/gs2c/common/js/html5-script-external.js'));
  assert.ok(html.includes('window.JsApiHelper=window.JsApiHelper||{init:function(){}}'));
  assert.ok(html.includes('stylename@generic~SESSION@12345678-1234-1234-1234-123456789abc'));
  assert.ok(!html.includes('8f7301d1-7367-462b-8d54-a3dd57c152d8'));
  assert.ok(!html.includes('demogamesfree.pragmaticplay.net/hub-demo'));
  assert.ok(!html.includes('clienthub.pragmaticplay.com'));
});
