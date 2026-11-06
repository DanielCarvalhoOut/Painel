// Ambiente HyperFrames: composições em HTML com legendas dinâmicas e zoom. Os arquivos ficam no
// Drive (o Colab enxerga as mesmas pastas); prévia e render leve rodam aqui, o pesado vai para o Colab.

import { mkdir, readFile, cp, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const RESOLUCOES = ['portrait', 'landscape', 'square'];
const QUALIDADES = ['draft', 'looks', 'delivery'];

const bin = (ctx) => path.join(ctx.config.app, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');

// Python da voz (hyperframes tts precisa do kokoro-onnx): o ambiente isolado em <app>/.tts-venv, se existir.
const pythonTts = (ctx) => {
  const py = path.join(ctx.config.app, '.tts-venv', 'Scripts', 'python.exe');
  return existsSync(py) ? { HYPERFRAMES_PYTHON: py } : {};
};

// Roda a CLI local do HyperFrames sem telemetria.
function hyperframes(ctx, args, cwd, extra) {
  return ctx.processos.iniciar({
    comando: process.execPath, args: [bin(ctx), ...args], cwd,
    env: { HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_SKIP_SKILLS: '1', ...pythonTts(ctx) },
    ...extra,
  });
}

// A composição é uma pasta FILHA de composicoes (nome simples, sem barras nem ".."); o caminho real é conferido.
function pastaComposicao(ctx, nome) {
  const n = String(nome ?? '');
  const dir = path.join(ctx.pastas.composicoes, n);
  if (!/^\w[\w.-]{0,99}$/.test(n) || !ctx.arquivos.dentroDe(dir, ctx.pastas.composicoes) || !existsSync(dir)) throw new Error('Composição não encontrada.');
  return dir;
}

async function composicoes(ctx) {
  const ativos = ctx.processos.ativos();
  return (await ctx.arquivos.listarPastas(ctx.pastas.composicoes)).map((c) => {
    const previa = ativos.find((p) => p.tipo === 'previa' && p.alvo === c.nome);
    return {
      ...c,
      valida: existsSync(path.join(c.caminho, 'index.html')),
      previa: previa ? { processo: previa.id, url: previa.url } : null,
      renderizando: ativos.some((p) => p.tipo === 'render' && p.alvo === c.nome),
    };
  });
}

export default {
  id: 'hyperframes',
  nome: 'HyperFrames',
  logo: 'logo.svg',
  icone: '[</>]',
  descricao: 'Estúdio de criação: vídeo feito em HTML, com animação, legendas, voz e efeitos. Cria até do zero.',
  tipo: 'ambiente',
  ordem: 30,
  papel: 'Criação e animação',
  // Perfil: aparece no cartão da Visão geral (forte em / use para / não é para). Testado em 2026-11-01.
  perfil: {
    forte: 'Animação e vídeo gerado: tudo é HTML animado, então dá para criar qualquer coisa, até sem gravação.',
    usos: [
      'legendas animadas palavra a palavra',
      'títulos, aberturas, lower thirds e transições (catálogo com 448 blocos)',
      'gráficos e dados animados',
      'voz a partir de texto (local; vozes pt-br Dora, Alex e Santa)',
      'tirar o fundo de pessoas (lento no CPU)',
      'vídeo de produto a partir de um site',
    ],
    naoE: 'cortar horas de material bruto; para isso, FilmCraft',
  },
  // Os vídeos enviados pela Visão geral caem na entrada daqui (no Drive, então o Colab também vê).
  recebe: { pasta: 'entrada', tipos: ['video', 'audio'], rotulo: 'HyperFrames/entrada' },
  usar: [{ rotulo: 'legendas e efeitos', descricao: 'Cria uma composição: legendas palavra a palavra, zoom, adesivos.', ir: true }],
  padroes: (g) => ({ app: path.join(g.ferramentas, 'HyperFrames'), drive: path.join(g.drive, 'HyperFrames'), workers: 1 }),
  pastas: (cfg) => ({
    entrada: path.join(cfg.drive, 'entrada'),
    composicoes: path.join(cfg.drive, 'composicoes'),
    transcricao: path.join(cfg.drive, 'transcricao'),
    saida: path.join(cfg.drive, 'saida'),
  }),

  async iniciar(ctx) {
    if (!existsSync(path.parse(ctx.config.drive).root)) return;
    await Promise.all(Object.values(ctx.pastas).map((d) => mkdir(d, { recursive: true }).catch(() => {})));
  },

  async estado(ctx) {
    const versao = await readFile(path.join(ctx.config.app, 'node_modules', 'hyperframes', 'package.json'), 'utf8')
      .then((t) => JSON.parse(t).version).catch(() => null);
    const drive = existsSync(path.parse(ctx.config.drive).root);
    const [entrada, transcricao, saida, comps] = await Promise.all([
      ctx.arquivos.listar(ctx.pastas.entrada, ['video', 'audio']),
      ctx.arquivos.listar(ctx.pastas.transcricao, ['legenda']),
      ctx.arquivos.listar(ctx.pastas.saida, ['video']),
      composicoes(ctx),
    ]);
    const ativos = ctx.processos.ativos();
    const render = ativos.find((p) => p.tipo === 'render');
    const previas = ativos.filter((p) => p.tipo === 'previa').length;
    return {
      status: !versao ? 'erro' : !drive ? 'aviso' : 'ok',
      rotulo: !versao ? 'não instalado' : !drive ? 'sem Drive' : render ? 'renderizando' : previas ? `${previas} prévia(s)` : 'pronto',
      resumo: !drive ? 'O Google Drive (G:) não está montado.' : null,
      versao,
      metricas: [
        ['Versão', versao || '—'],
        ['Na entrada', String(entrada.length)],
        ['Composições', String(comps.length)],
        ['Renders', String(saida.length)],
      ],
      ocupado: Boolean(render || previas),
      entrada, transcricao, saida, composicoes: comps,
    };
  },

  acoes: {
    // Cria uma composição a partir de um vídeo da entrada (copia, converte e, se pedido, transcreve aqui).
    async criar({ video, nome, formato, transcrever }, ctx) {
      if (!ctx.arquivos.dentroDe(video || '', ctx.pastas.entrada) || !existsSync(video)) throw new Error('Escolha um vídeo da entrada do HyperFrames.');
      const pasta = ctx.util.slug(nome) || ctx.util.slug(path.parse(video).name) || `video-${ctx.util.carimbo()}`;
      if (existsSync(path.join(ctx.pastas.composicoes, pasta))) throw new Error(`Já existe uma composição chamada "${pasta}".`);
      const args = ['init', pasta, '-v', video, '--non-interactive', '--skip-skills', '--example', 'blank',
        '--resolution', RESOLUCOES.includes(formato) ? formato : 'portrait',
        ...(transcrever ? ['--model', 'small', '--language', 'pt'] : ['--skip-transcribe'])];
      await mkdir(ctx.pastas.composicoes, { recursive: true });
      hyperframes(ctx, args, ctx.pastas.composicoes, { tipo: 'criar', titulo: `Criar composição "${pasta}"`, alvo: pasta });
      return { mensagem: `Criando "${pasta}"…` };
    },

    async previa({ composicao }, ctx) {
      const dir = pastaComposicao(ctx, composicao);
      const ativa = ctx.processos.ativos().find((p) => p.tipo === 'previa' && p.alvo === composicao);
      if (ativa) return { url: ativa.url };
      const porta = await ctx.util.portaLivre(3102);
      const url = `http://localhost:${porta}`;
      hyperframes(ctx, ['preview', dir, '--port', String(porta), '--no-open', '--foreground', '--force-new'], dir, {
        tipo: 'previa', titulo: `Prévia de "${composicao}"`, alvo: composicao, url,
      });
      return { mensagem: `Prévia subindo em ${url}`, url };
    },

    // Renderiza de uma cópia local: lendo direto do G: (Drive em modo transmissão) o FFmpeg falha às vezes ao
    // decodificar os áudios ("Invalid data found when processing input") e a CLI não consegue criar o hard link
    // da transação. O MP4 sai em HyperFrames/renders e depois é copiado para a saida do Drive.
    async render({ composicao, qualidade }, ctx) {
      const dir = pastaComposicao(ctx, composicao);
      const q = QUALIDADES.includes(qualidade) ? qualidade : 'looks';
      const local = path.join(ctx.config.app, '_render', path.basename(dir));
      await rm(local, { recursive: true, force: true });
      await cp(dir, local, { recursive: true, filter: (f) => !/[\\/](\.hyperframes|renders|node_modules)$/.test(f) });
      const nome = `${composicao}_${ctx.util.carimbo()}.mp4`;
      const pronto = path.join(ctx.config.app, 'renders', nome);
      const saida = path.join(ctx.pastas.saida, nome);
      await mkdir(path.dirname(pronto), { recursive: true });
      // Poucos workers: cada um abre um Chrome, e este PC tem pouca RAM livre.
      hyperframes(ctx, ['render', local, '-o', pronto, '-q', q, '-w', String(ctx.config.workers || 1)], local, {
        tipo: 'render', titulo: `Renderizar "${composicao}" (${q})`, alvo: composicao, dados: { arquivo: pronto },
        aoTerminar: (p) => {
          if (p.estado !== 'concluido') return;
          // A CLI pode sair com código 0 mesmo com "Render failed" (ex.: mixagem de áudio bloqueada).
          if (!existsSync(pronto)) {
            p.estado = 'erro';
            p.erro = p.log.filter((l) => /fail|erro|error/i.test(l)).slice(-2).join(' · ') || 'O render não gerou o MP4; veja o log.';
            return;
          }
          mkdir(ctx.pastas.saida, { recursive: true })
            .then(() => copyFile(pronto, saida))
            .then(() => { p.dados = { arquivo: saida }; ctx.publicar('plugin', {}); })
            .catch((e) => ctx.log(`não copiou para o Drive: ${e.message}`));
        },
      });
      return { mensagem: `Render de "${composicao}" iniciado (cópia local, depois vai para o Drive).` };
    },
  },
};
