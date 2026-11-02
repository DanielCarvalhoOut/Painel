// Carregador de plugins. Cada pasta em plugins/ com um plugin.mjs é um plugin; pastas que começam
// com "_" (ex.: _modelo) são ignoradas. O contrato está documentado em plugins/_modelo/LEIAME.md.

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TIPOS = ['ambiente', 'conector', 'servico'];

function validar(m, pasta) {
  if (!m || typeof m !== 'object') throw new Error('plugin.mjs precisa de "export default { ... }"');
  if (m.id !== pasta) throw new Error(`id "${m.id}" deve ser igual ao nome da pasta "${pasta}"`);
  if (!m.nome) throw new Error('falta "nome"');
  if (typeof m.estado !== 'function') throw new Error('falta a função "estado(ctx)"');
  if (m.tipo && !TIPOS.includes(m.tipo)) throw new Error(`tipo deve ser ${TIPOS.join(', ')}`);
}

// Base que os plugins usam para montar os padrões: a pasta do Drive compartilhada com o Colab e a pasta
// onde ficam as ferramentas instaladas (por padrão, a pasta que contém o Painel).
export function configGeral(config, dir) {
  return {
    drive: config.drive || 'G:\\Meu Drive\\EditorVideos',
    ferramentas: config.ferramentas || path.resolve(dir, '..', '..'),
  };
}

export async function carregarPlugins(dir, { config, nucleo }) {
  const plugins = [];
  const geral = configGeral(config, dir);
  const entradas = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const d of entradas) {
    if (!d.isDirectory() || /^[_.]/.test(d.name)) continue;
    const pastaPlugin = path.join(dir, d.name);
    const arquivo = path.join(pastaPlugin, 'plugin.mjs');
    if (!existsSync(arquivo)) continue;
    const desativado = config.desativados?.includes(d.name);
    try {
      const m = (await import(pathToFileURL(arquivo).href)).default;
      validar(m, d.name);
      const padroes = typeof m.padroes === 'function' ? m.padroes(geral) : (m.padroes || {});
      const cfg = { ...padroes, ...(config.plugins?.[m.id] || {}) };
      const pastas = typeof m.pastas === 'function' ? m.pastas(cfg) : (m.pastas || {});
      if (!desativado) for (const p of Object.values(pastas)) nucleo.arquivos.permitir(p);
      const ctx = {
        id: m.id,
        config: cfg,
        pastas,
        dir: pastaPlugin,
        util: nucleo.util,
        arquivos: nucleo.arquivos,
        processos: nucleo.processos.comEscopo(m.id),
        ffmpegDir: nucleo.ffmpegDir,
        publicar: (evento, dados) => nucleo.publicar(evento, { plugin: m.id, ...dados }),
        log: (...a) => console.log(`[${m.id}]`, ...a),
      };
      plugins.push({ m, ctx, desativado, temUI: existsSync(path.join(pastaPlugin, 'ui.js')), erro: null });
    } catch (e) {
      console.error(`[plugins] ${d.name}: ${e.message}`);
      plugins.push({ m: { id: d.name, nome: d.name, icone: '[!]', ordem: 999 }, ctx: null, desativado, temUI: false, erro: e.message });
    }
  }
  plugins.sort((a, b) => (a.m.ordem ?? 100) - (b.m.ordem ?? 100));

  for (const p of plugins) {
    if (p.erro || p.desativado || !p.m.iniciar) continue;
    try {
      await p.m.iniciar(p.ctx);
    } catch (e) {
      p.erro = `iniciar: ${e.message}`;
      console.error(`[${p.m.id}] ${p.erro}`);
    }
  }
  return plugins;
}

// O que a interface precisa saber de cada plugin (sem funções).
export function manifestoPublico(p) {
  const { id, nome, icone, descricao, tipo, ordem, papel, flutuante } = p.m;
  return {
    id, nome, icone: icone || '[ ]', descricao: descricao || '', tipo: tipo || 'ambiente', ordem: ordem ?? 100,
    logo: p.m.logo && !p.erro ? `/plugins/${id}/ui/${p.m.logo}` : null,
    papel: papel || null, flutuante: Boolean(flutuante), temUI: p.temUI, desativado: p.desativado, erro: p.erro,
    acoes: Object.keys(p.m.acoes || {}),
    // Envio de arquivos: quem recebe (manifesto.recebe) e o que cada plugin oferece fazer com eles (manifesto.usar).
    recebe: p.m.recebe ? { pasta: p.m.recebe.pasta, tipos: p.m.recebe.tipos || null, rotulo: p.m.recebe.rotulo || p.m.recebe.pasta } : null,
    perfil: p.m.perfil ? { forte: p.m.perfil.forte || '', usos: p.m.perfil.usos || [], naoE: p.m.perfil.naoE || '' } : null,
    usar: (p.m.usar || []).map(({ rotulo, descricao, acao, ir, aviso }) => ({ rotulo, descricao: descricao || '', acao: acao || null, ir: Boolean(ir), aviso: aviso || null })),
    pastas: p.ctx ? Object.keys(p.ctx.pastas) : [],
  };
}
