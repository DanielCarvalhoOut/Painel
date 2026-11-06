// Integração: sobe o servidor de verdade numa porta livre, com um plugin de teste, e fala com ele por HTTP
// (o mesmo caminho que a interface e a IA usam). Nenhum plugin real é carregado e nada abre o Explorer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarServidor } from '../core/servidor.mjs';
import { portaLivre } from '../core/util.mjs';

const PLUGIN = `
export default {
  id: 'teste', nome: 'Teste',
  recebe: { pasta: 'dados', tipos: ['video'] },
  pastas: (cfg) => ({ dados: cfg.dados }),
  async estado() { return { status: 'ok', rotulo: 'pronto' }; },
  acoes: {
    async ola({ nome }) { return { oi: nome }; },
    async recusa() { throw new Error('Escolha um vídeo da entrada.'); },
    async quebra() { const x = null; return x.campo; },
  },
};`;

let tmp, dados, fora, porta, painel;

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'painel-int-'));
  dados = path.join(tmp, 'dados');
  fora = path.join(tmp, 'fora');
  mkdirSync(path.join(tmp, 'plugins', 'teste'), { recursive: true });
  mkdirSync(dados);
  mkdirSync(fora);
  writeFileSync(path.join(tmp, 'plugins', 'teste', 'plugin.mjs'), PLUGIN);
  writeFileSync(path.join(dados, 'video.mp4'), '0123456789');
  writeFileSync(path.join(fora, 'segredo.txt'), 'não pode sair');
  symlinkSync(fora, path.join(dados, 'atalho'), 'junction');
  porta = await portaLivre(47100);
  painel = await criarServidor({ root: tmp, porta, config: { plugins: { teste: { dados } } } });
  await new Promise((ok) => painel.servidor.listen(porta, '127.0.0.1', ok));
});

after(async () => {
  await painel?.encerrar();
  rmSync(tmp, { recursive: true, force: true });
});

// http.request (e não fetch) para poder mandar qualquer Host e método, como um atacante faria.
function pedir(method, rota, { headers = {}, corpo } = {}) {
  return new Promise((ok, falha) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method, path: rota, headers: { host: `127.0.0.1:${porta}`, ...headers } }, (res) => {
      const partes = [];
      res.on('data', (p) => partes.push(p));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString();
        let json = null;
        try { json = JSON.parse(texto); } catch {}
        ok({ status: res.statusCode, headers: res.headers, texto, json });
      });
    });
    req.on('error', falha);
    req.end(corpo);
  });
}
const JSONH = { 'content-type': 'application/json' };
const acao = (plugin, corpo, headers = {}) => pedir('POST', `/api/plugins/${plugin}/acao`, { headers: { ...JSONH, ...headers }, corpo: JSON.stringify(corpo) });
const arquivo = (c, extra = '') => `/api/arquivo?caminho=${encodeURIComponent(c)}${extra}`;

test('toda resposta leva os cabeçalhos de proteção, inclusive erros', async () => {
  for (const r of [await pedir('GET', '/api/estado'), await pedir('GET', '/nada'), await pedir('GET', '/api/estado', { headers: { host: 'x.com' } })]) {
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
  }
});

test('erros sempre em JSON { erro }', async () => {
  for (const r of [await pedir('GET', '/nada'), await acao('teste', { acao: 'nao-existe' }), await pedir('GET', '/api/estado', { headers: { host: 'x.com' } })]) {
    assert.match(r.headers['content-type'], /^application\/json/);
    assert.equal(typeof r.json.erro, 'string');
  }
});

test('estado responde', async () => {
  const r = await pedir('GET', '/api/estado');
  assert.equal(r.status, 200);
  assert.equal(r.json.teste.status, 'ok');
});

test('CSRF: host estranho, outra origem, outro site, sem JSON e pré-voo são recusados', async () => {
  assert.equal((await pedir('GET', '/api/estado', { headers: { host: 'malicioso.com' } })).status, 421);
  assert.equal((await acao('teste', { acao: 'ola' }, { origin: 'http://exemplo.com' })).status, 403);
  assert.equal((await acao('teste', { acao: 'ola' }, { origin: 'null' })).status, 403);
  assert.equal((await acao('teste', { acao: 'ola' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await acao('teste', { acao: 'ola' }, { 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await pedir('POST', '/api/plugins/teste/acao', { headers: { 'content-type': 'text/plain' }, corpo: '{"acao":"ola"}' })).status, 415);
  assert.equal((await pedir('OPTIONS', '/api/plugins/teste/acao', { headers: { origin: 'http://exemplo.com', 'access-control-request-method': 'POST' } })).status, 405);
  assert.equal((await pedir('GET', '/api/estado', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('ação da própria origem funciona', async () => {
  const r = await acao('teste', { acao: 'ola', nome: 'Ana' }, { origin: `http://127.0.0.1:${porta}`, 'sec-fetch-site': 'same-origin' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { oi: 'Ana' });
});

test('ações: inexistente e propriedades herdadas → 404; plugin inexistente → 404', async () => {
  for (const nome of ['nao-existe', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 42, null]) {
    assert.equal((await acao('teste', { acao: nome })).status, 404, String(nome));
  }
  assert.equal((await acao('fantasma', { acao: 'ola' })).status, 404);
});

test('erros: recusa da ação → 400 com a mensagem; falha interna → 500 genérico', async () => {
  const recusa = await acao('teste', { acao: 'recusa' });
  assert.equal(recusa.status, 400);
  assert.equal(recusa.json.erro, 'Escolha um vídeo da entrada.');
  const quebra = await acao('teste', { acao: 'quebra' });
  assert.equal(quebra.status, 500);
  assert.doesNotMatch(quebra.json.erro, /null|campo|TypeError/);
});

test('corpo: JSON inválido → 400, não-objeto → 400, grande → 413', async () => {
  const cru = (corpo) => pedir('POST', '/api/plugins/teste/acao', { headers: JSONH, corpo });
  assert.equal((await cru('{x')).status, 400);
  assert.equal((await cru('[1]')).status, 400);
  assert.equal((await cru(JSON.stringify({ acao: 'ola', lixo: 'a'.repeat(200000) }))).status, 413);
});

test('método errado numa rota conhecida → 405 com Allow', async () => {
  const r = await pedir('GET', '/api/core');
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, 'POST');
  assert.equal((await pedir('POST', '/api/estado', { headers: JSONH, corpo: '{}' })).status, 405);
  assert.equal((await pedir('PUT', '/api/core', { headers: JSONH, corpo: '{}' })).status, 405);
});

test('núcleo: ação desconhecida, pasta herdada e processo inexistente → 404; mostrar fora → 403', async () => {
  const core = (c) => pedir('POST', '/api/core', { headers: JSONH, corpo: JSON.stringify(c) });
  assert.equal((await core({ acao: 'formatar' })).status, 404);
  assert.equal((await core({ acao: 'abrirPasta', plugin: 'teste', pasta: '__proto__' })).status, 404);
  assert.equal((await core({ acao: 'abrirPasta', plugin: 'teste', pasta: 'constructor' })).status, 404);
  assert.equal((await core({ acao: 'cancelar', id: 999 })).status, 404);
  assert.equal((await core({ acao: 'mostrar', caminho: path.join(fora, 'segredo.txt') })).status, 403);
  assert.equal((await core({ acao: 'mostrar', caminho: { toString: 1 } })).status, 403);
});

test('arquivo: serve o permitido, com Range', async () => {
  const r = await pedir('GET', arquivo(path.join(dados, 'video.mp4')));
  assert.equal(r.status, 200);
  assert.equal(r.texto, '0123456789');
  const parte = await pedir('GET', arquivo(path.join(dados, 'video.mp4')), { headers: { range: 'bytes=2-4' } });
  assert.equal(parte.status, 206);
  assert.equal(parte.texto, '234');
  assert.equal((await pedir('GET', arquivo(path.join(dados, 'video.mp4')), { headers: { range: 'bytes=8-2' } })).status, 416);
  assert.equal((await pedir('GET', arquivo(path.join(dados, 'video.mp4')), { headers: { range: 'bytes=50-' } })).status, 416);
});

test('arquivo: "..", junção, caminho de dispositivo, vazio e inexistente', async () => {
  const proibidos = [path.join(dados, '..', 'fora', 'segredo.txt'), path.join(dados, 'atalho', 'segredo.txt'), '\\\\?\\' + path.join(fora, 'segredo.txt'),
    process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd', path.join(dados, 'video.mp4:oculto')];
  for (const c of proibidos) {
    const r = await pedir('GET', arquivo(c));
    assert.equal(r.status, 403, c);
    assert.doesNotMatch(r.texto, /não pode sair/);
  }
  assert.equal((await pedir('GET', '/api/arquivo')).status, 403);
  assert.equal((await pedir('GET', arquivo(path.join(dados, 'sumiu.mp4')))).status, 404);
});

test('envio: exige X-Painel, fica dentro da pasta e recusa nome reservado', async () => {
  const enviar = (nome, headers = { 'x-painel': 'enviar' }) =>
    pedir('POST', `/api/enviar?plugin=teste&nome=${encodeURIComponent(nome)}`, { headers: { 'content-type': 'application/octet-stream', ...headers }, corpo: 'abc' });
  assert.equal((await enviar('a.mp4', {})).status, 403);
  const ok = await enviar('..\\..\\fora\\pego.mp4');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.arquivo.nome, 'pego.mp4');
  assert.ok(existsSync(path.join(dados, 'pego.mp4')));
  assert.deepEqual(readdirSync(fora), ['segredo.txt']);
  assert.equal((await enviar('NUL.mp4')).status, 400);
  assert.equal((await enviar('x.exe')).status, 400);
  assert.equal((await pedir('POST', '/api/enviar?plugin=fantasma&nome=a.mp4', { headers: { 'x-painel': 'enviar' }, corpo: 'x' })).status, 404);
});

test('interface de plugin: só arquivos da pasta ui', async () => {
  assert.equal((await pedir('GET', '/plugins/teste/ui/..%2F..%2Fplugin.mjs')).status, 404);
  assert.equal((await pedir('GET', '/plugins/teste/plugin.mjs')).status, 404);
});
