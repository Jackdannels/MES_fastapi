const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../../frontend/node_modules/jsdom');
const html = fs.readFileSync(path.join(__dirname, '../../preview/critical-alarm/index.html'), 'utf8');
function setup(hash = '2') {
  const dom = new JSDOM(html, {url: `http://127.0.0.1:8911/#${hash}`, runScripts: 'outside-only'});
  const $ = id => dom.window.document.getElementById(id);
  $('details').showModal = function () { this.open = true; };
  $('details').close = function () { this.open = false; };
  dom.window.eval(dom.window.document.querySelector('script').textContent);
  return { dom, $, change: (id, value) => { $(id).value = value; $(id).dispatchEvent(new dom.window.Event('change')); } };
}
test('all three deep links show distinct alarm placements', () => {
  for (const [hash, target] of [['1','inlineAlarm'],['2','chipAlarm'],['3','bannerAlarm']]) {
    const { dom, $ } = setup(hash);
    try {
      for (const id of ['inlineAlarm','chipAlarm','bannerAlarm']) assert.equal($(id).hidden, id !== target);
    } finally { dom.window.close(); }
  }
});
test('overview-only reminder disappears on task page, global options remain and preserve draft', () => {
  const { dom, $, change } = setup('1');
  try {
    change('pageSelect','tasks'); assert.ok($('inlineAlarm').hidden);
    const input = dom.window.document.querySelector('#tasksContent input'); input.value = 'draft';
    dom.window.document.querySelector('[data-scheme="2"]').click(); assert.equal($('chipAlarm').hidden, false);
    dom.window.document.querySelector('[data-scheme="3"]').click(); assert.equal($('bannerAlarm').hidden, false);
    assert.equal(input.value, 'draft');
  } finally { dom.window.close(); }
});
test('detail, acknowledgement, recovery, theme and motion controls are local', () => {
  const { dom, $, change } = setup();
  try {
    $('chipAlarm').click(); assert.ok($('details').open);
    $('acknowledge').click(); assert.match($('ackStatus').textContent,/已知悉/); assert.equal($('chipAlarm').hidden,false);
    change('stateSelect','recovered'); assert.equal($('details').open,false); assert.ok($('chipAlarm').hidden); assert.ok($('sidebarAlarm').hidden);
    $('theme').click(); assert.equal(dom.window.document.documentElement.dataset.theme,'light');
    $('motion').checked=false; $('motion').dispatchEvent(new dom.window.Event('change')); assert.ok(dom.window.document.body.classList.contains('paused'));
    assert.match(html,/connect-src 'none'/); assert.doesNotMatch(html,/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    assert.match(html,/prefers-reduced-motion:reduce/);
  } finally { dom.window.close(); }
});
