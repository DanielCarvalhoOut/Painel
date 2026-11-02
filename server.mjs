// Painel — central do estúdio. Núcleo pequeno: servidor HTTP, eventos ao vivo, processos, arquivos
// e um carregador de plugins. Tudo que é específico (PullCut, HyperFrames, FilmCraft, Colab…)
// mora em plugins/<id>/ e entra só criando a pasta. Só escuta em 127.0.0.1, sem dependências.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as util from './core/util.mjs';
import { criarProcessos } from './core/processos.mjs';
import { criarArquivos } from './core/arquivos.mjs';
import { carregarPlugins, manifestoPublico } from './core/plugins.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(ROOT, 'painel.config.json'), 'utf8').catch(() => '{}'));
const PORT = Number(process.env.PAINEL_PORT || config.porta || 4700);

// ---------- eventos ao vivo (SSE) ----------
const ouvintes = new Set();
function publicar(evento, dados) {
  const texto = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const res of ouvintes) res.write(texto);
}

// ---------- núcleo ----------
const ffmpegDir = util.acharFfmpeg();
const nucleo = {
  util,
  ffmpegDir,
  publicar,
  arquivos: criarArquivos(),
  processos: criarProcessos({
    publicar,
    envExtra: ffmpegDir ? { PATH: `${ffmpegDir};${process.env.PATH}` } : {},
  }),
};
const plugins = await carregarPlugins(path.join(ROOT, 'plugins'), { config, nucleo });
const ativos = () => plugins.filter((p) => !p.erro && !p.desativado);
const porId = (id) => ativos().find((p) => p.m.id === id);

// Estado de um plugin, com tempo limite: um plugin lento ou com erro não trava o painel.
async function estadoDe(p) {
  const limite = new Promise((_, rej) => setTimeout(() => rej(new Error('não respondeu a tempo')), 6000));
  try {
    const e = await Promise.race([p.m.estado(p.ctx), limite]);
    return { ...e, processos: p.ctx.processos.listar() };
  } catch (e) {
    return { status: 'erro', rotulo: 'erro', resumo: e.message, processos: p.ctx.processos.listar() };
  }
}

// Receitas da Visão geral (receitas.json): só as que têm todas as ferramentas ativas. Lido a cada pedido,
// então editar o arquivo não exige reiniciar.
async function receitas() {
  try {
    const { receitas: lista = [] } = JSON.parse(await readFile(path.join(ROOT, 'receitas.json'), 'utf8'));
    return lista.filter((r) => (r.ferramentas || []).every((id) => porId(id)));
  } catch (e) {
    console.error(`receitas.json: ${e.message}`);
    return [];
  }
}

// ---------- arquivos estáticos ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
async function estatico(res, arquivo) {
  if (!existsSync(arquivo)) return util.json(res, 404, { erro: 'Não encontrado.' });
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(await readFile(arquivo));
}

// ---------- rotas ----------
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rota = url.pathname;
  try {
    if (req.method === 'GET' && rota === '/') return estatico(res, path.join(ROOT, 'public', 'index.html'));

    // Interface do núcleo (casca + helpers que os plugins importam).
    const core = rota.match(/^\/core\/([\w.-]+\.(?:js|css|svg))$/);
    if (req.method === 'GET' && core) return estatico(res, path.join(ROOT, 'public', 'core', core[1]));

    // Interface de cada plugin: plugins/<id>/ui.js e plugins/<id>/ui/*.
    const ui = rota.match(/^\/plugins\/([\w-]+)\/(ui\.js|ui\/[\w.-]+)$/);
    if (req.method === 'GET' && ui) {
      const p = porId(ui[1]);
      if (!p) return util.json(res, 404, { erro: 'Plugin não encontrado.' });
      return estatico(res, path.join(ROOT, 'plugins', ui[1], ui[2]));
    }

    if (req.method === 'GET' && rota === '/api/plugins') {
      return util.json(res, 200, { plugins: plugins.map(manifestoPublico), receitas: await receitas(), ffmpeg: Boolean(ffmpegDir), animacoes: config.animacoes || 'sempre' });
    }

    if (req.method === 'GET' && rota === '/api/estado') {
      const lista = ativos();
      const estados = await Promise.all(lista.map(estadoDe));
      return util.json(res, 200, Object.fromEntries(lista.map((p, i) => [p.m.id, estados[i]])));
    }

    const est = rota.match(/^\/api\/plugins\/([\w-]+)\/estado$/);
    if (req.method === 'GET' && est) {
      const p = porId(est[1]);
      return p ? util.json(res, 200, await estadoDe(p)) : util.json(res, 404, { erro: 'Plugin não encontrado.' });
    }

    const acao = rota.match(/^\/api\/plugins\/([\w-]+)\/acao$/);
    if (req.method === 'POST' && acao) {
      const p = porId(acao[1]);
      if (!p) return util.json(res, 404, { erro: 'Plugin não encontrado.' });
      const { acao: nome, ...params } = await util.lerCorpo(req);
      const fn = p.m.acoes?.[nome];
      if (!fn) return util.json(res, 400, { erro: `Ação "${nome}" não existe em ${p.m.nome}.` });
      try {
        return util.json(res, 200, (await fn(params, p.ctx)) ?? { ok: true });
      } catch (e) {
        return util.json(res, 400, { erro: e.message });
      }
    }

    // Ações do núcleo, iguais para todos os plugins.
    if (req.method === 'POST' && rota === '/api/core') {
      const c = await util.lerCorpo(req);
      try {
        if (c.acao === 'abrirPasta') {
          const dir = porId(c.plugin)?.ctx.pastas[c.pasta];
          if (!dir) throw new Error('Pasta desconhecida.');
          await nucleo.arquivos.abrirPasta(dir);
        } else if (c.acao === 'mostrar') {
          nucleo.arquivos.mostrar(c.caminho);
        } else if (c.acao === 'cancelar') {
          nucleo.processos.cancelar(c.id);
        } else {
          throw new Error('Ação desconhecida.');
        }
        return util.json(res, 200, { ok: true });
      } catch (e) {
        return util.json(res, 400, { erro: e.message });
      }
    }

    if (req.method === 'GET' && rota === '/api/arquivo') {
      return nucleo.arquivos.servir(req, res, url.searchParams.get('caminho'), { baixar: url.searchParams.has('baixar') });
    }

    // Envio de arquivos (vídeos da pessoa) para a pasta que um plugin declara em manifesto.recebe.
    // O cabeçalho X-Painel obriga o navegador a pedir licença (CORS) antes: outro site aberto no
    // navegador não consegue gravar arquivos aqui só por saber o endereço.
    if (req.method === 'POST' && rota === '/api/enviar') {
      const origem = req.headers.origin;
      if (req.headers['x-painel'] !== 'enviar' || (origem && origem !== `http://${req.headers.host}`)) {
        return util.json(res, 403, { erro: 'Envio recusado.' });
      }
      const p = porId(url.searchParams.get('plugin'));
      const dir = p?.m.recebe && p.ctx.pastas[p.m.recebe.pasta];
      if (!dir) return util.json(res, 404, { erro: 'Nenhum plugin recebe arquivos aqui.' });
      try {
        const arquivo = await nucleo.arquivos.receber(req, dir, url.searchParams.get('nome'), p.m.recebe.tipos);
        publicar('plugin', { plugin: p.m.id });
        return util.json(res, 200, { arquivo });
      } catch (e) {
        return util.json(res, 400, { erro: e.message });
      }
    }

    if (req.method === 'GET' && rota === '/api/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }

    // Rotas próprias de plugins (opcional): /api/plugins/<id>/...
    const propria = rota.match(/^\/api\/plugins\/([\w-]+)\//);
    const p = propria && porId(propria[1]);
    if (p?.m.rotas && (await p.m.rotas(req, res, url, p.ctx))) return;

    util.json(res, 404, { erro: 'Não encontrado.' });
  } catch (e) {
    if (res.headersSent) return res.destroy();
    util.json(res, 500, { erro: e.message });
  }
});

async function encerrar() {
  nucleo.processos.encerrarTodos();
  for (const p of ativos()) await p.m.encerrar?.(p.ctx).catch?.(() => {});
  process.exit(0);
}
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sinal, encerrar);

servidor.listen(PORT, '127.0.0.1', () => {
  console.log(`Painel rodando em http://127.0.0.1:${PORT}`);
  for (const p of plugins) console.log(`  ${p.erro ? '[!]' : p.desativado ? '[ ]' : '[ok]'} ${p.m.nome}${p.erro ? ` — ${p.erro}` : p.desativado ? ' (desativado)' : ''}`);
});
