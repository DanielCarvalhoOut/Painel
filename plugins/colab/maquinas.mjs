// Máquinas do Colab, tarefas do Painel e perfis de configuração (quais máquinas cada tarefa usa).
// Os perfis ficam em Painel/colab-perfis.json (fora do git); sem o arquivo, valem os perfis de fábrica.

import { readFile, writeFile, rename } from 'node:fs/promises';

// O que o Colab CLI aceita em `colab new` (--gpu ou nada = CPU). A disponibilidade depende do plano.
export const MAQUINAS = {
  CPU: { nome: 'CPU', gpu: false, ramAlta: true, explica: 'Sem placa de vídeo, a mais barata. O render do HyperFrames usa o processador, então é a certa para ele.' },
  T4: { nome: 'NVIDIA T4 · 16 GB', gpu: true, ramAlta: true, explica: 'A GPU mais econômica. Dá conta de transcrição e narração.' },
  L4: { nome: 'NVIDIA L4 · 24 GB', gpu: true, ramAlta: false, explica: 'Mais rápida que a T4 e com mais memória de vídeo; gasta mais unidades por hora. Boa para narração longa e 3D.' },
  G4: { nome: 'NVIDIA G4', gpu: true, ramAlta: true, explica: 'Geração mais nova do Colab. Disponibilidade e custo variam por plano: confira o gasto medido.' },
  A100: { nome: 'NVIDIA A100 · 40 GB', gpu: true, ramAlta: true, explica: 'Muito mais forte e bem mais cara por hora. Para trabalho pesado: 3D, lotes grandes.' },
  H100: { nome: 'NVIDIA H100 · 80 GB', gpu: true, ramAlta: true, explica: 'A mais forte. Pode não estar disponível no seu plano.' },
};
const GPUS = Object.keys(MAQUINAS).filter((m) => MAQUINAS[m].gpu);

// Tarefas que rodam pelo Colab CLI e as máquinas que servem para cada uma (os notebooks usam CUDA, então TPU não entra).
export const TAREFAS = {
  transcrever: { rotulo: 'Transcrição (Whisper)', maquinas: GPUS },
  voz: { rotulo: 'Narração (Chatterbox)', maquinas: GPUS },
  renderizar: { rotulo: 'Render (HyperFrames)', maquinas: ['CPU'] },
  // O Cycles do Blender usa a GPU (CUDA/OptiX); CPU também serve, só que bem mais devagar.
  blender: { rotulo: '3D (Blender)', maquinas: [...GPUS, 'CPU'] },
  // TRELLIS.2 pede 24 GB de memória de vídeo e foi compilado para Ampere, Ada e Hopper (A100, L4, H100).
  ia3d: { rotulo: '3D por IA (TRELLIS.2)', maquinas: ['L4', 'A100', 'H100'] },
};

export const OPCOES = {
  maquina: 'Que computador o Google liga. Mais forte = mais rápido, mas gasta mais unidades por hora.',
  ramAlta: 'Mais memória RAM (Colab Pro). Ajuda no render longo; a L4 só tem um tamanho.',
  manterMin: 'Deixa a máquina ligada depois da tarefa. A próxima tarefa na mesma máquina começa na hora, sem o preparo (uns 5 min na narração) e sem pedir de novo o Drive. Gasta unidades enquanto estiver ligada.',
  limiteMin: 'Tempo máximo da tarefa. Passou disso, o Painel derruba a tarefa e desliga a máquina.',
};

const tarefa = (maquina, ramAlta, manterMin, limiteMin) => ({ maquina, ramAlta, manterMin, limiteMin });
export const FABRICA = {
  padrao: 'economico',
  perfis: {
    economico: {
      nome: 'Econômico',
      tarefas: { transcrever: tarefa('T4', false, 0, 60), voz: tarefa('T4', false, 0, 60), renderizar: tarefa('CPU', true, 0, 120), blender: tarefa('T4', false, 0, 90), ia3d: tarefa('L4', false, 0, 120) },
    },
    rapido: {
      nome: 'Rápido',
      tarefas: { transcrever: tarefa('L4', false, 0, 60), voz: tarefa('L4', false, 0, 60), renderizar: tarefa('CPU', true, 0, 120), blender: tarefa('L4', false, 0, 90), ia3d: tarefa('A100', true, 0, 120) },
    },
    sessao: {
      nome: 'Sessão de trabalho',
      tarefas: { transcrever: tarefa('T4', false, 20, 60), voz: tarefa('T4', false, 20, 60), renderizar: tarefa('CPU', true, 20, 120), blender: tarefa('T4', false, 20, 90), ia3d: tarefa('L4', false, 20, 120) },
    },
  },
};

const inteiro = (v, min, max, padrao) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

// Limpa uma configuração de tarefa vinda da interface (ou do arquivo): só valores que o rodar.sh aceita.
export function normalizarTarefa(id, t = {}) {
  const info = TAREFAS[id];
  const maquina = info.maquinas.includes(t.maquina) ? t.maquina : info.maquinas[0];
  return {
    maquina,
    ramAlta: Boolean(t.ramAlta) && MAQUINAS[maquina].ramAlta,
    manterMin: inteiro(t.manterMin, 0, 120, 0),
    limiteMin: inteiro(t.limiteMin, 5, 720, 60),
  };
}

export function normalizarPerfil(p = {}) {
  const nome = String(p.nome || '').trim().slice(0, 40);
  if (!nome) throw new Error('Dê um nome ao perfil.');
  const tarefas = {};
  for (const id of Object.keys(TAREFAS)) tarefas[id] = normalizarTarefa(id, p.tarefas?.[id] || FABRICA.perfis.economico.tarefas[id]);
  return { nome, tarefas };
}

// Nome da sessão no Colab, igual ao que o rodar.sh calcula: uma por tipo de máquina.
export const nomeSessao = (t) => `editorvideos-${t.maquina.toLowerCase()}${t.ramAlta ? '-hm' : ''}`;

// Argumentos do rodar.sh para uma tarefa.
export function argsMaquina(t) {
  return ['--maquina', t.maquina, ...(t.ramAlta ? ['--ram-alta'] : []), ...(t.manterMin > 0 ? ['--manter'] : []), '--limite', String(t.limiteMin * 60)];
}

export async function lerPerfis(arquivo) {
  try {
    const d = JSON.parse(await readFile(arquivo, 'utf8'));
    const perfis = {};
    for (const [id, p] of Object.entries(d.perfis || {})) {
      if (/^[a-z0-9-]{1,40}$/.test(id)) perfis[id] = normalizarPerfil(p);
    }
    if (!Object.keys(perfis).length) throw new Error('sem perfis');
    return { padrao: perfis[d.padrao] ? d.padrao : Object.keys(perfis)[0], perfis };
  } catch {
    return structuredClone(FABRICA);
  }
}

export async function gravarJson(arquivo, dados) {
  const tmp = `${arquivo}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(dados, null, 2));
  await rename(tmp, arquivo);
}

// Nome simples de vídeo/áudio para ir ao notebook (ARQUIVO=...): sem pastas, "..", ":", caracteres de controle,
// nem começar com "-", "." ou espaço (não vira opção nem arquivo oculto).
export const nomeDeMidia = (n) =>
  typeof n === 'string' && n.length <= 200 && !n.includes('..') && !/^[\s.-]/.test(n) &&
  /^[^\\/:*?"<>|\x00-\x1f]+\.(mp4|mov|mkv|webm|m4v|mp3|m4a|wav|aac|ogg|opus)$/i.test(n);
