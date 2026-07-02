// Gate tests for capi-payload.js. No framework — plain assertion runner,
// consistent with the rest of this project (see services/lead-capture/tests).
// Run: node netlify/functions/tests/run-tests.js
'use strict';

const assert = require('assert');
const {
  buildEventPayload, attachTestEventCode,
  normalizePhone, normalizeEmail, normalizeName, normalizeCity, normalizeState, normalizeZip, normalizeBirthdate,
  sha256,
} = require('../capi-payload');

let passed = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(label + ': ' + e.message);
  }
}

check('normalizePhone adds 55 country code to an 11-digit number', function () {
  assert.strictEqual(normalizePhone('(31) 99999-9999'), '5531999999999');
});

check('normalizePhone keeps an already-international number untouched', function () {
  assert.strictEqual(normalizePhone('5531999999999'), '5531999999999');
});

check('normalizePhone returns null for empty input', function () {
  assert.strictEqual(normalizePhone(''), null);
  assert.strictEqual(normalizePhone(null), null);
});

check('normalizeEmail lowercases and trims', function () {
  assert.strictEqual(normalizeEmail('  Joao@Example.COM  '), 'joao@example.com');
});

check('normalizeEmail returns null for empty input', function () {
  assert.strictEqual(normalizeEmail(''), null);
});

check('normalizeName splits first and last name, strips accents and punctuation', function () {
  assert.deepStrictEqual(normalizeName('  João da Silva-Pereira  '), { firstName: 'joao', lastName: 'da silvapereira' });
});

check('normalizeName handles a single-word name', function () {
  assert.deepStrictEqual(normalizeName('Maria'), { firstName: 'maria', lastName: null });
});

check('normalizeName returns nulls for empty input', function () {
  assert.deepStrictEqual(normalizeName(''), { firstName: null, lastName: null });
  assert.deepStrictEqual(normalizeName(null), { firstName: null, lastName: null });
});

check('normalizeCity lowercases and strips spaces/accents/punctuation', function () {
  assert.strictEqual(normalizeCity('Belo Horizonte'), 'belohorizonte');
  assert.strictEqual(normalizeCity('São Paulo'), 'saopaulo');
});

check('normalizeCity returns null for empty input', function () {
  assert.strictEqual(normalizeCity(''), null);
});

check('normalizeState accepts a 2-letter UF and lowercases it', function () {
  assert.strictEqual(normalizeState('SP'), 'sp');
  assert.strictEqual(normalizeState('mg'), 'mg');
});

check('normalizeState rejects anything that is not exactly 2 letters', function () {
  assert.strictEqual(normalizeState('Minas Gerais'), null);
  assert.strictEqual(normalizeState(''), null);
});

check('normalizeZip strips non-digits', function () {
  assert.strictEqual(normalizeZip('30130-000'), '30130000');
});

check('normalizeZip returns null for empty input', function () {
  assert.strictEqual(normalizeZip(''), null);
});

check('normalizeBirthdate converts YYYY-MM-DD to YYYYMMDD', function () {
  assert.strictEqual(normalizeBirthdate('1990-05-21'), '19900521');
});

check('normalizeBirthdate returns null for malformed input', function () {
  assert.strictEqual(normalizeBirthdate('21/05/1990'), null);
  assert.strictEqual(normalizeBirthdate(''), null);
});

check('sha256 is deterministic and lowercase hex', function () {
  var h = sha256('joao@example.com');
  assert.strictEqual(h.length, 64);
  assert.strictEqual(h, h.toLowerCase());
  assert.strictEqual(h, sha256('joao@example.com'));
});

check('buildEventPayload builds a Purchase event with hashed phone', function () {
  var payload = buildEventPayload({
    event_name: 'Purchase',
    event_id: 'lead-123',
    value: 1500.5,
    phone: '(31) 99999-9999',
  });
  var ev = payload.data[0];
  assert.strictEqual(ev.event_name, 'Purchase');
  assert.strictEqual(ev.event_id, 'lead-123');
  assert.strictEqual(ev.custom_data.value, 1500.5);
  assert.strictEqual(ev.custom_data.currency, 'BRL');
  assert.strictEqual(ev.user_data.ph[0], sha256('5531999999999'));
  assert.ok(!ev.user_data.em, 'should not include em when email was not given');
});

check('buildEventPayload includes hashed email when present', function () {
  var payload = buildEventPayload({
    event_name: 'Purchase',
    event_id: 'lead-123',
    value: 100,
    email: 'Joao@Example.com',
  });
  assert.strictEqual(payload.data[0].user_data.em[0], sha256('joao@example.com'));
});

check('buildEventPayload includes hashed first/last name when present', function () {
  var payload = buildEventPayload({
    event_name: 'Purchase', event_id: 'lead-123', value: 100, phone: '11999998888', name: 'João da Silva',
  });
  var ud = payload.data[0].user_data;
  assert.strictEqual(ud.fn[0], sha256('joao'));
  assert.strictEqual(ud.ln[0], sha256('da silva'));
});

check('buildEventPayload omits ln when name has no surname', function () {
  var payload = buildEventPayload({
    event_name: 'Purchase', event_id: 'lead-123', value: 100, phone: '11999998888', name: 'Maria',
  });
  var ud = payload.data[0].user_data;
  assert.strictEqual(ud.fn[0], sha256('maria'));
  assert.ok(!ud.ln, 'should not include ln when there is no surname');
});

check('buildEventPayload includes hashed external_id when present', function () {
  var payload = buildEventPayload({
    event_name: 'Purchase', event_id: 'lead-123', value: 100, phone: '11999998888', external_id: 'lead-abc-123',
  });
  assert.strictEqual(payload.data[0].user_data.external_id[0], sha256('lead-abc-123'));
});

check('buildEventPayload omits fn/ln/external_id when not given', function () {
  var payload = buildEventPayload({ event_name: 'Lead', event_id: 'x', phone: '11999998888' });
  var ud = payload.data[0].user_data;
  assert.ok(!ud.fn && !ud.ln && !ud.external_id);
});

check('buildEventPayload includes hashed ct/st/zp/db when present', function () {
  var payload = buildEventPayload({
    event_name: 'Purchase', event_id: 'lead-123', value: 100, phone: '11999998888',
    city: 'Belo Horizonte', state: 'MG', zip: '30130-000', birthdate: '1990-05-21',
  });
  var ud = payload.data[0].user_data;
  assert.strictEqual(ud.ct[0], sha256('belohorizonte'));
  assert.strictEqual(ud.st[0], sha256('mg'));
  assert.strictEqual(ud.zp[0], sha256('30130000'));
  assert.strictEqual(ud.db[0], sha256('19900521'));
});

check('buildEventPayload omits ct/st/zp/db when not given', function () {
  var payload = buildEventPayload({ event_name: 'Lead', event_id: 'x', phone: '11999998888' });
  var ud = payload.data[0].user_data;
  assert.ok(!ud.ct && !ud.st && !ud.zp && !ud.db);
});

check('buildEventPayload rejects unknown event_name', function () {
  assert.throws(function () {
    buildEventPayload({ event_name: 'PageView', event_id: 'x', phone: '11999998888' });
  }, /event_name/);
});

check('buildEventPayload rejects missing event_id', function () {
  assert.throws(function () {
    buildEventPayload({ event_name: 'Lead', phone: '11999998888' });
  }, /event_id/);
});

check('buildEventPayload rejects when neither phone nor email is given', function () {
  assert.throws(function () {
    buildEventPayload({ event_name: 'Lead', event_id: 'x' });
  }, /phone or email/);
});

check('buildEventPayload rejects Purchase without a positive value', function () {
  assert.throws(function () {
    buildEventPayload({ event_name: 'Purchase', event_id: 'x', phone: '11999998888', value: 0 });
  }, /value/);
});

check('buildEventPayload allows Lead without a value', function () {
  var payload = buildEventPayload({ event_name: 'Lead', event_id: 'x', phone: '11999998888' });
  assert.strictEqual(payload.data[0].custom_data, undefined);
});

check('attachTestEventCode leaves payload untouched when no code is given', function () {
  var payload = { data: [{ event_name: 'Lead' }] };
  assert.strictEqual(attachTestEventCode(payload, undefined), payload);
});

check('attachTestEventCode adds test_event_code without mutating the original payload', function () {
  var payload = { data: [{ event_name: 'Lead' }] };
  var withCode = attachTestEventCode(payload, 'TEST12345');
  assert.strictEqual(withCode.test_event_code, 'TEST12345');
  assert.strictEqual(withCode.data, payload.data);
  assert.strictEqual(payload.test_event_code, undefined);
});

console.log('Passed: ' + passed);
if (failures.length) {
  console.log('Failed: ' + failures.length);
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('All tests passed.');
process.exit(0);
