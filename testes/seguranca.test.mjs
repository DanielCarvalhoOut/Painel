import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { criarChecagem } from '../core/seguranca.mjs';
import { lerCorpo } from '../core/util.mjs';

const checar = criarChecagem(4700);
const pedido = (method, headers = {}) => ({ method, headers: { host: '127.0.0.1:4700', ...headers } });
const json = { 'content-type': 'application/json' };

test('host desconhecido é recusado (DNS rebinding)', () => {
  assert.equal(checar(pedido('GET', { host: 'malicioso.com:4700' }), '/api/estado')[0], 421);
  assert.equal(checar(pedido('GET', { host: 'localhost:4700' }), '/api/estado'), null);
});

test('leitura de outro site é recusada', () => {
  assert.equal(checar(pedido('GET', { 'sec-fetch-site': 'cross-site' }), '/api/estado')[0], 403);
});

test('escrita sem Origin e com JSON passa (curl, IA no terminal)', () => {
  assert.equal(checar(pedido('POST', json), '/api/plugins/colab/acao'), null);
});

test('escrita de outra origem é recusada', () => {
  assert.equal(checar(pedido('POST', { ...json, origin: 'http://exemplo.com' }), '/api/core')[0], 403);
  assert.equal(checar(pedido('POST', { ...json, 'sec-fetch-site': 'same-site' }), '/api/core')[0], 403);
  assert.equal(checar(pedido('POST', { ...json, origin: 'http://127.0.0.1:4700', 'sec-fetch-site': 'same-origin' }), '/api/core'), null);
});

test('escrita sem Content-Type JSON é recusada, menos no envio de arquivo', () => {
  assert.equal(checar(pedido('POST', { 'content-type': 'text/plain' }), '/api/core')[0], 415);
  assert.equal(checar(pedido('POST', { 'content-type': 'application/octet-stream' }), '/api/enviar'), null);
});

const corpo = (texto) => Readable.from([Buffer.from(texto)]);

test('lerCorpo: JSON inválido → 400, grande demais → 413, vazio → {}', async () => {
  await assert.rejects(lerCorpo(corpo('{x')), { status: 400 });
  await assert.rejects(lerCorpo(corpo('[1,2]')), { status: 400 });
  await assert.rejects(lerCorpo(corpo('"' + 'a'.repeat(200000) + '"')), { status: 413 });
  assert.deepEqual(await lerCorpo(corpo('')), {});
  assert.deepEqual(await lerCorpo(corpo('{"a":1}')), { a: 1 });
});
