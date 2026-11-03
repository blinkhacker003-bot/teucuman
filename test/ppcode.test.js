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
