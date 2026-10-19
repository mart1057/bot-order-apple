const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createUI } = require('../ui-server');

test('local UI validates products, runs one bot, streams output, and stops it', async () => {
  let child, launched;
  const config = { selectedProduct: 'phone', products: { phone: { name: 'Test phone', partNumber: 'PART', options: { dimensionCapacity: '256gb' } } } };
  const { server } = createUI({ readConfig: () => config, launch: (exe, args) => {
    launched = args;
    child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = signal => { child.emit('close', null, signal); };
    return child;
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data, origin = base) => fetch(base + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    assert.equal((await fetch(base)).status, 200);
    const products = await (await fetch(base + '/api/products')).json();
    assert.equal(products.apiVersion, 2);
    assert.equal(products.quantity, 1);
    assert.equal(products.products[0].key, 'phone');
    assert.equal(products.products[0].partNumber, undefined);
    assert.equal((await post('/api/start', { productKey: 'phone' }, 'http://evil.example')).status, 403);
    assert.equal((await post('/api/start', { productKey: 'unknown' })).status, 400);
    for (const quantity of [0, -1, 1.5, '2']) assert.equal((await post('/api/start', { productKey: 'phone', quantity })).status, 400);
    assert.equal((await post('/api/start', { productKey: 'phone', quantity: 2 })).status, 200);
    assert.deepEqual(launched.slice(-4), ['--product', 'phone', '--quantity', '2']);
    assert.equal((await post('/api/start', { productKey: 'phone' })).status, 409);
    child.stdout.write('Stock pending\n');
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.running, true);
    assert.equal(status.quantity, 2);
    assert.match(status.logs.join(''), /Stock pending/);
    assert.equal((await post('/api/stop', {})).status, 200);
    assert.equal((await (await fetch(base + '/api/status')).json()).running, false);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await post('/api/start', { productKey: 'phone' })).status, 200);
    child.emit('error', new Error('test failure'));
    child.emit('close', 1);
    assert.equal((await (await fetch(base + '/api/status')).json()).running, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
