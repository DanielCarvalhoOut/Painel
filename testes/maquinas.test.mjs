import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTarefa, normalizarPerfil, nomeSessao, argsMaquina, FABRICA } from '../plugins/colab/maquinas.mjs';

test('máquina fora da lista da tarefa cai na primeira permitida', () => {
  assert.equal(normalizarTarefa('transcrever', { maquina: 'CPU' }).maquina, 'T4');
  assert.equal(normalizarTarefa('transcrever', { maquina: 'A100' }).maquina, 'A100');
});

test('limites são presos a faixas seguras', () => {
  const t = normalizarTarefa('voz', { maquina: 'T4', manterMin: 999, limiteMin: 1 });
  assert.equal(t.manterMin, 120);
  assert.equal(t.limiteMin, 5);
});

test('perfil precisa de nome e completa tarefas faltando', () => {
  assert.throws(() => normalizarPerfil({ nome: '  ' }));
  const p = normalizarPerfil({ nome: 'Teste', tarefas: { voz: { maquina: 'L4' } } });
  assert.equal(p.tarefas.voz.maquina, 'L4');
  assert.deepEqual(Object.keys(p.tarefas).sort(), Object.keys(FABRICA.perfis.economico.tarefas).sort());
});

test('nome de sessão e argumentos do rodar.sh', () => {
  const t = { maquina: 'L4', ramAlta: true, manterMin: 20, limiteMin: 30 };
  assert.equal(nomeSessao(t), 'editorvideos-l4-hm');
  assert.deepEqual(argsMaquina(t), ['--maquina', 'L4', '--ram-alta', '--manter', '--limite', '1800']);
  assert.deepEqual(argsMaquina({ maquina: 'T4', ramAlta: false, manterMin: 0, limiteMin: 60 }), ['--maquina', 'T4', '--limite', '3600']);
});

test('perfil padrão de fábrica existe', () => {
  assert.ok(FABRICA.perfis[FABRICA.padrao]);
});
