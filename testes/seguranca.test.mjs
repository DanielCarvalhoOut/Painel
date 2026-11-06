import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { criarChecagem, CABECALHOS } from '../core/seguranca.mjs';
import { lerCorpo } from '../core/util.mjs';

const checar = criarChecagem(4700);
const pedido = (method, headers = {}) => ({ method, headers: { host: '127.0.0.1:4700', ...headers } });
const json = { 'content-type': 'application/json' };

test('host desconhecido é recusado (DNS rebinding)', () => {
  assert.equal(checar(pedido('GET', { host: 'malicioso.com:4700' }), '/api/estado')[0], 421);
  assert.equal(checar(pedido('GET', { host: '127.0.0.1:9999' }), '/api/estado')[0], 421);
  assert.equal(checar(pedido('GET', { host: 'localhost:4700' }), '/api/estado'), null);
  assert.equal(checar(pedido('GET', { host: 'LOCALHOST:4700' }), '/api/estado'), null);
});

test('só GET, HEAD e POST: OPTIONS (pré-voo de CORS), PUT e DELETE são recusados', () => {
  for (const m of ['OPTIONS', 'PUT', 'DELETE', 'PATCH', 'TRACE']) assert.equal(checar(pedido(m, json), '/api/core')[0], 405, m);
  assert.equal(checar(pedido('HEAD'), '/api/estado'), null);
});

test('leitura da API por outro site ou outra porta de localhost é recusada', () => {
  assert.equal(checar(pedido('GET', { 'sec-fetch-site': 'cross-site' }), '/api/estado')[0], 403);
  assert.equal(checar(pedido('GET', { 'sec-fetch-site': 'same-site' }), '/api/arquivo')[0], 403);
  assert.equal(checar(pedido('GET', { 'sec-fetch-site': 'same-origin' }), '/api/estado'), null);
  assert.equal(checar(pedido('GET', { 'sec-fetch-site': 'none' }), '/api/estado'), null);
});

test('escrita sem Origin e com JSON passa (curl, IA no terminal)', () => {
  assert.equal(checar(pedido('POST', json), '/api/plugins/colab/acao'), null);
  assert.equal(checar(pedido('POST', { 'content-type': 'application/json; charset=utf-8' }), '/api/core'), null);
});

test('escrita de outra origem é recusada, inclusive Origin "null"', () => {
  assert.equal(checar(pedido('POST', { ...json, origin: 'http://exemplo.com' }), '/api/core')[0], 403);
  assert.equal(checar(pedido('POST', { ...json, origin: 'null' }), '/api/core')[0], 403);
  assert.equal(checar(pedido('POST', { ...json, origin: 'http://127.0.0.1:4701' }), '/api/core')[0], 403);
  assert.equal(checar(pedido('POST', { ...json, origin: 'https://127.0.0.1:4700' }), '/api/core')[0], 403);
  assert.equal(checar(pedido('POST', { ...json, 'sec-fetch-site': 'same-site' }), '/api/core')[0], 403);
  assert.equal(checar(pedido('POST', { ...json, origin: 'http://127.0.0.1:4700', 'sec-fetch-site': 'same-origin' }), '/api/core'), null);
  assert.equal(checar(pedido('POST', { ...json, origin: 'http://localhost:4700' }), '/api/core'), null);
});

test('escrita só com Content-Type JSON de verdade (os tipos "simples" de formulário não passam)', () => {
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp', 'application/json-patch+json', '']) {
    assert.equal(checar(pedido('POST', { 'content-type': ct }), '/api/core')[0], 415, ct);
  }
});

test('envio de arquivo exige o cabeçalho X-Painel (força o pré-voo de CORS)', () => {
  const cru = { 'content-type': 'application/octet-stream' };
  assert.equal(checar(pedido('POST', cru), '/api/enviar')[0], 403);
  assert.equal(checar(pedido('POST', { ...cru, 'x-painel': 'outro' }), '/api/enviar')[0], 403);
  assert.equal(checar(pedido('POST', { ...cru, 'x-painel': 'enviar' }), '/api/enviar'), null);
  assert.equal(checar(pedido('POST', { ...cru, 'x-painel': 'enviar', origin: 'http://exemplo.com' }), '/api/enviar')[0], 403);
});

test('cabeçalhos contra clickjacking e embutir de fora', () => {
  assert.equal(CABECALHOS['X-Frame-Options'], 'DENY');
  assert.match(CABECALHOS['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(CABECALHOS['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(CABECALHOS['X-Content-Type-Options'], 'nosniff');
});

const corpo = (texto) => Readable.from([Buffer.from(texto)]);

test('lerCorpo: JSON inválido → 400, grande demais → 413, vazio → {}', async () => {
  await assert.rejects(lerCorpo(corpo('{x')), { status: 400 });
  await assert.rejects(lerCorpo(corpo('[1,2]')), { status: 400 });
  await assert.rejects(lerCorpo(corpo('null')), { status: 400 });
  await assert.rejects(lerCorpo(corpo('"' + 'a'.repeat(200000) + '"')), { status: 413 });
  assert.deepEqual(await lerCorpo(corpo('')), {});
  assert.deepEqual(await lerCorpo(corpo('{"a":1}')), { a: 1 });
});
