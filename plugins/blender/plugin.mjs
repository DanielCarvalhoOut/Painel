// Blender: modelos 3D feitos por script (procedurais), renderizados no PC ou no Colab.
// Cada modelo é um .py em Blender/scripts (os que começam com "_" são bibliotecas, como _estudio.py).
// Saída: Blender/saida/<nome>/ com .png (render), .glb (modelo para web/outros apps) e .blend.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, stat, mkdir, copyFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CANDIDATOS = [
  'D:\\Blender\\blender.exe',
  'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
  'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe',
];

let versao = null;

// Bibliotecas que o Painel precisa (vêm no repo, em blender/): sem elas o 3D por IA e os scripts não rodam.
// Na primeira vez elas são copiadas para Blender/scripts; uma versão que você editou lá não é sobrescrita.
const BIBLIOTECAS = ['_estudio.py', '_vitrine.py'];
const DO_REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'blender');

function app(ctx) {
  if (ctx.config.app && existsSync(ctx.config.app)) return ctx.config.app;
  return CANDIDATOS.find((c) => existsSync(c)) || null;
}

function lerVersao(exe) {
  return new Promise((ok) => {
    execFile(exe, ['-b', '--factory-startup', '--version'], { timeout: 20000, windowsHide: true }, (err, saida) => {
      const m = /Blender\s+([\d.]+)/.exec(String(saida || ''));
      ok(m ? m[1] : null);
    });
  });
}

async function scripts(ctx) {
  try {
    const itens = await readdir(ctx.pastas.scripts, { withFileTypes: true });
    return itens.filter((i) => i.isFile() && i.name.endsWith('.py') && !i.name.startsWith('_')).map((i) => i.name.slice(0, -3)).sort();
  } catch {
    return [];
  }
}

// Cada pasta em saida/ é um resultado; junta o png, o glb e o blend que tiver.
async function resultados(ctx) {
  const pastas = await ctx.arquivos.listarPastas(ctx.pastas.saida);
  const lista = [];
  for (const p of pastas.slice(0, 24)) {
    const arquivos = await ctx.arquivos.listar(p.caminho, ['imagem', 'modelo3d', 'video']);
    if (!arquivos.length) continue;
    const ach = (ext) => arquivos.find((a) => a.nome.toLowerCase().endsWith(ext) && !a.nome.includes('_entrada')) || null;
    lista.push({
      nome: p.nome, caminho: p.caminho, modificado: Math.max(...arquivos.map((a) => a.modificado)),
      onde: p.nome.endsWith('-ia') ? 'IA · Colab' : p.nome.endsWith('-colab') ? 'Colab' : 'PC',
      png: ach('.png'), glb: ach('.glb'), blend: ach('.blend'), mp4: ach('.mp4'),
      entrada: arquivos.find((a) => a.nome.includes('_entrada')) || null,
    });
  }
  return lista.sort((a, b) => b.modificado - a.modificado);
}

export default {
  id: 'blender',
  nome: 'Blender',
  icone: '[3d]',
  descricao: 'Modelos 3D por script, render no PC ou no Colab (.png, .glb, .blend).',
  tipo: 'ambiente',
  ordem: 35,
  papel: '3D',

  padroes: (g) => ({ app: 'D:\\Blender\\blender.exe', pasta: path.join(g.ferramentas, 'Blender') }),
  // Imagens para o 3D por IA (TRELLIS.2 no Colab) chegam pelo envio da própria aba.
  recebe: { pasta: 'entrada', tipos: ['imagem'], rotulo: 'Blender/entrada' },
  pastas: (cfg) => ({ scripts: path.join(cfg.pasta, 'scripts'), saida: path.join(cfg.pasta, 'saida'), entrada: path.join(cfg.pasta, 'entrada') }),

  async iniciar(ctx) {
    await mkdir(ctx.pastas.scripts, { recursive: true });
    for (const b of BIBLIOTECAS) {
      const destino = path.join(ctx.pastas.scripts, b);
      if (!existsSync(destino) && existsSync(path.join(DO_REPO, b))) await copyFile(path.join(DO_REPO, b), destino);
    }
    const exe = app(ctx);
    if (exe) versao = await lerVersao(exe);
  },

  async estado(ctx) {
    const exe = app(ctx);
    const [lista, res, imagens] = await Promise.all([scripts(ctx), resultados(ctx), ctx.arquivos.listar(ctx.pastas.entrada, ['imagem'])]);
    const rodando = ctx.processos.ativos().filter((p) => p.tipo === 'render3d');
    return {
      status: exe ? 'ok' : 'aviso',
      rotulo: exe ? (rodando.length ? 'renderizando' : 'pronto') : 'Blender não encontrado',
      resumo: exe ? null : 'Instale o Blender ou ajuste plugins.blender.app no painel.config.json.',
      metricas: [['Versão', versao || '—'], ['Modelos', String(lista.length)], ['Resultados', String(res.length)]],
      ocupado: rodando.length > 0,
      app: exe, versao, scripts: lista, resultados: res, imagens,
    };
  },

  acoes: {
    // Render no PC (CPU). porcentagem: 10–100 do 1080x1350; amostras: 16–4096.
    async gerar({ script, nome, porcentagem = 100, amostras = 128 } = {}, ctx) {
      const exe = app(ctx);
      if (!exe) throw new Error('Blender não encontrado.');
      const s = String(script || '').replace(/\.py$/, '');
      const caminho = path.join(ctx.pastas.scripts, `${s}.py`);
      if (!s || s.startsWith('_') || !ctx.arquivos.dentroDe(caminho, ctx.pastas.scripts) || !existsSync(caminho)) throw new Error('Script não encontrado.');
      const n = ctx.util.slug(nome || s) || s;
      const saida = path.join(ctx.pastas.saida, n);
      const pct = Math.min(100, Math.max(10, Number(porcentagem) || 100));
      const amo = Math.min(4096, Math.max(16, Number(amostras) || 128));
      const p = ctx.processos.iniciar({
        tipo: 'render3d', alvo: n, titulo: `Blender: ${s} → ${n} (${pct}%, ${amo} amostras, PC)`,
        comando: exe, args: ['-b', '--factory-startup', '--offline-mode', '-P', caminho, '--', saida, String(pct), String(amo)],
        cwd: ctx.pastas.scripts,
        lerLinha(linha, proc) {
          const m = /Sample (\d+)\/(\d+)/.exec(linha);
          if (m) proc.progresso = Math.round((Number(m[1]) / Number(m[2])) * 100);
        },
        aoTerminar: () => ctx.publicar('arquivos', { plugin: 'blender' }),
      });
      return { mensagem: `Render iniciado no PC: ${n}.`, processo: p.id };
    },

    // Abre o .blend no Blender com interface, para mexer à mão.
    async abrir({ caminho } = {}, ctx) {
      const exe = app(ctx);
      if (!exe) throw new Error('Blender não encontrado.');
      if (!caminho || !ctx.arquivos.dentroDe(caminho, ctx.pastas.saida) || !existsSync(caminho) || !caminho.endsWith('.blend')) {
        throw new Error('Arquivo .blend não encontrado.');
      }
      spawn(exe, [caminho], { detached: true, stdio: 'ignore' }).unref();
      return { mensagem: 'Abrindo no Blender.' };
    },
  },
};
