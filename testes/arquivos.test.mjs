// Caminhos: tudo fora das pastas permitidas tem de ser recusado, inclusive por junção ou link simbólico.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { criarArquivos, caminhoReal, nomeReservado } from '../core/arquivos.mjs';

const WIN = process.platform === 'win32';
let tmp, raiz, fora, irma, arquivos, temLinkArquivo = true;

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'painel-arq-'));
  raiz = path.join(tmp, 'raiz');
  fora = path.join(tmp, 'fora');
  irma = path.join(tmp, 'raiz-irma'); // começa com o mesmo texto da raiz, mas é outra pasta
  for (const d of [raiz, fora, irma, path.join(raiz, 'sub')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(raiz, 'video.mp4'), 'ok');
  writeFileSync(path.join(fora, 'segredo.txt'), 'não pode sair');
  writeFileSync(path.join(irma, 'outro.mp4'), 'não pode sair');
  // Junção não precisa de administrador no Windows; link de arquivo pode precisar (aí o teste é pulado).
  symlinkSync(fora, path.join(raiz, 'atalho'), 'junction');
  try {
    symlinkSync(path.join(fora, 'segredo.txt'), path.join(raiz, 'link.txt'), 'file');
  } catch {
    temLinkArquivo = false;
  }
  arquivos = criarArquivos();
  arquivos.permitir(raiz);
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test('caminhoReal recusa entradas perigosas', () => {
  for (const ruim of [undefined, null, 42, {}, ['a'], '', 'a\0b']) assert.equal(caminhoReal(ruim), null, String(ruim));
  assert.equal(caminhoReal('\\\\?\\C:\\Windows'), null);
  assert.equal(caminhoReal('\\\\.\\PhysicalDrive0'), null);
  assert.equal(caminhoReal('//./nul'), null);
  if (WIN) assert.equal(caminhoReal(path.join(raiz, 'video.mp4:oculto')), null);
});

test('dentro da pasta: arquivo, subpasta e algo que ainda não existe', () => {
  assert.ok(arquivos.permitido(path.join(raiz, 'video.mp4')));
  assert.ok(arquivos.permitido(path.join(raiz, 'sub')));
  assert.ok(arquivos.permitido(path.join(raiz, 'novo', 'ainda-nao.mp4')));
  assert.ok(arquivos.permitido(raiz));
  if (WIN) assert.ok(arquivos.permitido(path.join(raiz, 'VIDEO.MP4')));
});

test('fora da pasta: "..", pasta irmã com o mesmo começo e caminhos absolutos', () => {
  assert.equal(arquivos.permitido(path.join(raiz, '..', 'fora', 'segredo.txt')), false);
  assert.equal(arquivos.permitido(`${raiz}${path.sep}sub${path.sep}..${path.sep}..${path.sep}fora`), false);
  assert.equal(arquivos.permitido(path.join(irma, 'outro.mp4')), false);
  assert.equal(arquivos.permitido(fora), false);
  assert.equal(arquivos.permitido(WIN ? 'C:\\Windows\\win.ini' : '/etc/passwd'), false);
  assert.equal(arquivos.permitido(''), false);
  assert.equal(arquivos.permitido(undefined), false);
});

test('junção dentro da pasta apontando para fora é recusada', () => {
  assert.equal(arquivos.permitido(path.join(raiz, 'atalho')), false);
  assert.equal(arquivos.permitido(path.join(raiz, 'atalho', 'segredo.txt')), false);
  assert.equal(arquivos.dentroDe(path.join(raiz, 'atalho', 'segredo.txt'), raiz), false);
});

test('link simbólico de arquivo apontando para fora é recusado', (t) => {
  if (!temLinkArquivo) return t.skip('criar link de arquivo exige o Modo de Desenvolvedor ou administrador');
  assert.equal(arquivos.permitido(path.join(raiz, 'link.txt')), false);
});

test('listar ignora junções e links', async () => {
  const nomes = (await arquivos.listar(raiz)).map((a) => a.nome);
  assert.deepEqual(nomes, ['video.mp4']);
  assert.deepEqual((await arquivos.listarPastas(raiz)).map((p) => p.nome), ['sub']);
});

test('nomes reservados do Windows', () => {
  for (const n of ['CON', 'con.mp4', 'NUL.wav', 'aux.txt', 'COM1.mp4', 'lpt9.mp3', 'conin$']) assert.ok(nomeReservado(n), n);
  for (const n of ['console.mp4', 'conta.mp4', 'nulo.wav', 'com10.mp4', 'video.mp4']) assert.equal(nomeReservado(n), false, n);
});

const req = (texto, headers = {}) => Object.assign(Readable.from([Buffer.from(texto)]), { headers });

test('receber: nome com pastas fica só com o nome, dentro da pasta', async () => {
  const destino = path.join(raiz, 'entrada');
  const r = await arquivos.receber(req('abc'), destino, '..\\..\\fora\\pego.mp4', ['video']);
  assert.equal(r.nome, 'pego.mp4');
  assert.ok(existsSync(path.join(destino, 'pego.mp4')));
  assert.equal(existsSync(path.join(fora, 'pego.mp4')), false);
  const r2 = await arquivos.receber(req('abc'), destino, 'pego.mp4', ['video']);
  assert.equal(r2.nome, 'pego (2).mp4', 'não sobrescreve');
});

test('receber: recusa nome reservado, formato errado e pasta fora', async () => {
  const destino = path.join(raiz, 'entrada');
  await assert.rejects(arquivos.receber(req('x'), destino, 'CON.mp4', ['video']), { status: 400 });
  await assert.rejects(arquivos.receber(req('x'), destino, 'virus.exe', ['video']), { status: 400 });
  await assert.rejects(arquivos.receber(req('x'), destino, '.mp4', ['video']), { status: 400 });
  await assert.rejects(arquivos.receber(req('x'), fora, 'a.mp4', ['video']), { status: 403 });
  await assert.rejects(arquivos.receber(req('x'), path.join(raiz, 'atalho'), 'a.mp4', ['video']), { status: 403 });
  assert.deepEqual(readdirSync(fora), ['segredo.txt']);
});

test('receber: envio cortado não deixa arquivo pela metade', async () => {
  const destino = path.join(raiz, 'cortado');
  await assert.rejects(arquivos.receber(req('abc', { 'content-length': '10' }), destino, 'meio.mp4', ['video']), { status: 400 });
  assert.deepEqual(readdirSync(destino), []);
});
