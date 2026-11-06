import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErroHttp, respostaDeErro } from '../core/util.mjs';

test('ErroHttp leva o próprio status', () => {
  assert.deepEqual(respostaDeErro(new ErroHttp(404, 'Não achei.')), [404, 'Não achei.']);
  assert.deepEqual(respostaDeErro(new ErroHttp(413, 'Grande.')), [413, 'Grande.']);
});

test('Error comum de uma ação é recusa do pedido (400, mensagem para a pessoa)', () => {
  assert.deepEqual(respostaDeErro(new Error('Escolha um vídeo.')), [400, 'Escolha um vídeo.']);
});

test('falha de programação ou do sistema vira 500 sem vazar detalhes', () => {
  const vazaria = 'C:\\Users\\alguem\\segredo';
  const casos = [new TypeError(`x de ${vazaria}`), new ReferenceError('y'), Object.assign(new Error(`ENOENT ${vazaria}`), { code: 'ENOENT' }),
    Object.assign(new Error('z'), { code: 'ERR_INVALID_ARG_TYPE' }), 'texto solto', null, undefined];
  for (const e of casos) {
    const [status, msg] = respostaDeErro(e);
    assert.equal(status, 500);
    assert.ok(!msg.includes('alguem'));
  }
});
