// Ambiente FilmCraft: editor de timeline com interface própria. O Painel abre o app com o
// servidor de controle ligado e manda mídia e legendas para ele pela CLI.

import { spawn, execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';


const exe = (ctx) => path.join(ctx.config.app, 'filmcraft.exe');

function cli(ctx, args) {
  return new Promise((resolve) => {
    execFile(path.join(ctx.config.app, 'filmcraft-cli.exe'), ['--bridge', `127.0.0.1:${ctx.config.portaControle}`, '--compact', ...args],
      { windowsHide: true, timeout: 120000 },
      (err, out, errOut) => resolve({ ok: !err, saida: String(out).trim(), erro: err ? (String(errOut).trim().split(/\r?\n/).at(-1) || err.message) : null }));
  });
}

export default {
  id: 'filmcraft',
  nome: 'FilmCraft',
  logo: 'logo.png',
  icone: '[|||]',
  descricao: 'Editor de timeline (NLE) com interface própria; recebe mídia e legendas do Colab.',
  tipo: 'ambiente',
  ordem: 40,
  papel: 'Montagem',
  perfil: {
    forte: 'Edição tradicional na timeline, com as suas mãos no controle.',
    usos: ['cortar e ordenar clipes', 'juntar trilha e narração', 'ajustar legendas .srt à mão', 'exportar o corte final'],
    naoE: 'animação e efeitos gerados; para isso, HyperFrames',
  },
  usar: [{ rotulo: 'cortar e montar', acao: 'montar', descricao: 'Abre o FilmCraft (se precisar) e põe o vídeo na mídia do projeto.' }],
  padroes: (g) => ({
    app: path.join(g.ferramentas, 'FilmCraft', 'app', 'filmcraft-0.15.0-windows-x64-portable'),
    drive: path.join(g.drive, 'FilmCraft'),
    projetos: path.join(g.ferramentas, 'FilmCraft', 'projetos'),
    portaControle: 9876,
  }),
  pastas: (cfg) => ({
    entrada: path.join(cfg.drive, 'entrada'),
    transcricao: path.join(cfg.drive, 'transcricao'),
    saida: path.join(cfg.drive, 'saida'),
    projetos: cfg.projetos,
  }),

  async iniciar(ctx) {
    await mkdir(ctx.pastas.projetos, { recursive: true }).catch(() => {});
    if (!existsSync(path.parse(ctx.config.drive).root)) return;
    await Promise.all(['entrada', 'transcricao', 'saida'].map((k) => mkdir(ctx.pastas[k], { recursive: true }).catch(() => {})));
  },

  async estado(ctx) {
    const instalado = existsSync(exe(ctx));
    const [rodando, controle, entrada, transcricao, saida] = await Promise.all([
      ctx.util.processoRodando('filmcraft.exe'),
      ctx.util.portaAberta(ctx.config.portaControle),
      ctx.arquivos.listar(ctx.pastas.entrada, ['video', 'audio']),
      ctx.arquivos.listar(ctx.pastas.transcricao, ['legenda']),
      ctx.arquivos.listar(ctx.pastas.saida, ['video', 'audio']),
    ]);
    const versao = path.basename(ctx.config.app).match(/\d+\.\d+\.\d+/)?.[0] || null;
    let status = 'off';
    let rotulo = 'fechado';
    if (!instalado) [status, rotulo] = ['erro', 'não instalado'];
    else if (controle) [status, rotulo] = ['ok', 'aberto'];
    else if (rodando) [status, rotulo] = ['aviso', 'aberto sem conexão'];
    return {
      status, rotulo, versao, instalado, rodando, controle,
      resumo: status === 'aviso' ? 'Aberto fora do Painel: feche e abra por aqui para poder importar.' : null,
      atalhos: instalado && !controle && !rodando ? [{ acao: 'abrir', rotulo: '[>] abrir' }] : [],
      metricas: [
        ['Versão', versao || '—'],
        ['Na entrada', String(entrada.length)],
        ['Legendas', String(transcricao.length)],
        ['Exportados', String(saida.length)],
      ],
      ocupado: controle,
      entrada, transcricao, saida,
    };
  },

  acoes: {
    async abrir(_, ctx) {
      if (!existsSync(exe(ctx))) throw new Error('FilmCraft não está instalado.');
      if (await ctx.util.portaAberta(ctx.config.portaControle)) return { mensagem: 'O FilmCraft já está aberto e conectado.' };
      if (await ctx.util.processoRodando('filmcraft.exe')) {
        throw new Error('O FilmCraft já está aberto, mas sem conexão com o Painel. Feche-o e abra de novo por aqui.');
      }
      spawn(exe(ctx), ['--control', String(ctx.config.portaControle)], { cwd: ctx.config.app, detached: true, stdio: 'ignore' }).unref();
      return { mensagem: 'Abrindo o FilmCraft…' };
    },

    // Vídeo/áudio entram na mídia do projeto; .srt/.vtt viram legendas na timeline.
    async importar({ caminho }, ctx) {
      if (!ctx.arquivos.permitido(caminho) || !existsSync(caminho)) throw new Error('Arquivo não encontrado.');
      if (!(await ctx.util.portaAberta(ctx.config.portaControle))) throw new Error('Abra o FilmCraft pelo Painel primeiro.');
      const legenda = ['.srt', '.vtt'].includes(path.extname(caminho).toLowerCase());
      const r = await cli(ctx, legenda ? ['exec', 'captions.import', `path=${caminho}`] : ['import', caminho]);
      if (!r.ok) throw new Error(`O FilmCraft recusou: ${r.erro}`);
      return { mensagem: `${path.basename(caminho)} enviado ao FilmCraft.` };
    },

    // "Cortar e montar" de um vídeo enviado na Visão geral: abre o FilmCraft se estiver fechado,
    // espera a conexão (até 40 s) e importa.
    async montar({ caminho }, ctx) {
      if (!ctx.arquivos.permitido(caminho) || !existsSync(caminho)) throw new Error('Arquivo não encontrado.');
      if (!(await ctx.util.portaAberta(ctx.config.portaControle))) {
        if (!existsSync(exe(ctx))) throw new Error('FilmCraft não está instalado.');
        if (await ctx.util.processoRodando('filmcraft.exe')) {
          throw new Error('O FilmCraft já está aberto, mas sem conexão com o Painel. Feche-o e tente de novo.');
        }
        spawn(exe(ctx), ['--control', String(ctx.config.portaControle)], { cwd: ctx.config.app, detached: true, stdio: 'ignore' }).unref();
        for (let i = 0; i < 80 && !(await ctx.util.portaAberta(ctx.config.portaControle)); i++) await new Promise((r) => setTimeout(r, 500));
        if (!(await ctx.util.portaAberta(ctx.config.portaControle))) throw new Error('O FilmCraft abriu, mas não conectou a tempo. Use [→ timeline] na aba FilmCraft.');
      }
      const r = await cli(ctx, ['import', caminho]);
      if (!r.ok) throw new Error(`O FilmCraft recusou: ${r.erro}`);
      return { mensagem: `${path.basename(caminho)} está na mídia do FilmCraft.` };
    },
  },
};
