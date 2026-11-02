// Conector do PullCut. O PullCut continua um app independente (porta 4747); aqui o Painel só
// conversa com ele por HTTP, liga o servidor se estiver desligado e mostra a interface dele.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';


async function ligar(ctx) {
  const servidor = path.join(ctx.config.app, 'server.mjs');
  if (!existsSync(servidor)) throw new Error(`PullCut não encontrado em ${ctx.config.app}.`);
  const porta = new URL(ctx.config.url).port || '80';
  spawn(process.execPath, [servidor], {
    cwd: ctx.config.app, detached: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PULLCUT_PORT: porta },
  }).unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await ctx.util.portaAberta(Number(porta))) return true;
  }
  throw new Error('O PullCut não respondeu depois de ligar.');
}

// Escuta os eventos do PullCut e repassa ao Painel, para a barra de download andar ao vivo.
function escutar(ctx) {
  let ultimo = 0;
  const conectar = async () => {
    try {
      const r = await fetch(`${ctx.config.url}/api/eventos`);
      const leitor = r.body.getReader();
      for (;;) {
        const { done } = await leitor.read();
        if (done) break;
        if (Date.now() - ultimo > 700) {
          ultimo = Date.now();
          ctx.publicar('plugin', {});
        }
      }
    } catch {}
    setTimeout(conectar, 5000);
  };
  conectar();
}

export default {
  id: 'pullcut',
  nome: 'PullCut',
  logo: 'logo.svg',
  icone: '[↓]',
  descricao: 'Baixa vídeo inteiro, trecho ou só o áudio a partir de uma URL.',
  tipo: 'conector',
  ordem: 10,
  papel: 'Captura',
  perfil: {
    forte: 'Trazer mídia de uma URL para o estúdio, inteira ou só o trecho que interessa.',
    usos: ['baixar um vídeo seu ou com licença', 'pegar só um trecho', 'extrair só o áudio'],
    naoE: 'editar; ele só traz o material (o seu próprio vídeo entra por "Enviar vídeo")',
  },
  padroes: (g) => ({ url: 'http://127.0.0.1:4747', app: path.join(g.ferramentas, 'PullCut'), iniciarJunto: true }),
  pastas: (cfg) => ({ downloads: path.join(cfg.app, 'downloads') }),

  async iniciar(ctx) {
    const porta = Number(new URL(ctx.config.url).port);
    if (ctx.config.iniciarJunto && !(await ctx.util.portaAberta(porta))) {
      await ligar(ctx).catch((e) => ctx.log(e.message));
    }
    escutar(ctx);
  },

  async estado(ctx) {
    let dados;
    try {
      dados = await ctx.util.buscarJson(`${ctx.config.url}/api/estado`, { timeout: 2000 });
    } catch {
      return {
        status: 'off', rotulo: 'desligado', url: ctx.config.url,
        resumo: 'O servidor do PullCut não está rodando.',
        atalhos: [{ acao: 'ligar', rotulo: '[>] ligar' }],
      };
    }
    const tarefas = dados.tarefas || [];
    const baixando = tarefas.filter((t) => t.estado === 'baixando');
    const concluidas = tarefas.filter((t) => t.estado === 'concluido').length;
    const falta = [!dados.ytdlp && 'yt-dlp', !dados.ffmpeg && 'FFmpeg'].filter(Boolean);
    return {
      status: falta.length ? 'aviso' : 'ok',
      rotulo: baixando.length ? `baixando ${baixando.length}` : 'pronto',
      resumo: falta.length ? `Falta ${falta.join(' e ')}.` : null,
      url: ctx.config.url,
      metricas: [
        ['Endereço', ctx.config.url.replace('http://', '')],
        ['Baixando', String(baixando.length)],
        ['Concluídos', String(concluidas)],
        ['Destinos', String((dados.destinos || []).filter((d) => d.disponivel).length)],
      ],
      ocupado: baixando.length > 0,
      atividade: tarefas.slice(0, 8).map((t) => ({
        titulo: t.titulo,
        estado: t.estado === 'baixando' ? 'rodando' : t.estado,
        progresso: t.estado === 'baixando' ? t.progresso : null,
        detalhe: t.erro || `${t.descricao || ''} → ${t.destino}`,
        quando: t.criadoEm,
      })),
    };
  },

  acoes: {
    async ligar(_, ctx) {
      const porta = Number(new URL(ctx.config.url).port);
      if (await ctx.util.portaAberta(porta)) return { mensagem: 'O PullCut já está ligado.' };
      await ligar(ctx);
      return { mensagem: 'PullCut ligado.' };
    },
  },
};
