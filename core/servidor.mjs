// Monta o servidor do Painel (rotas, eventos, plugins) sem ligar a porta: server.mjs liga, e os testes de
// integração montam um com plugins de mentira numa porta livre.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as util from './util.mjs';
import { criarProcessos } from './processos.mjs';
import { criarArquivos } from './arquivos.mjs';
import { carregarPlugins, manifestoPublico } from './plugins.mjs';
import { criarChecagem, CABECALHOS } from './seguranca.mjs';

const { ErroHttp, json, lerCorpo, responderErro } = util;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Rotas da API e os métodos que cada uma aceita (para responder 405 em vez de 404 quando o método está errado).
const METODOS = [
  [/^\/api\/plugins$/, 'GET'], [/^\/api\/estado$/, 'GET'], [/^\/api\/plugins\/[\w-]+\/estado$/, 'GET'],
  [/^\/api\/plugins\/[\w-]+\/acao$/, 'POST'], [/^\/api\/core$/, 'POST'], [/^\/api\/arquivo$/, 'GET'],
  [/^\/api\/enviar$/, 'POST'], [/^\/api\/eventos$/, 'GET'],
];

export async function criarServidor({ root, porta, config = {}, pastaPlugins = path.join(root, 'plugins'), ffmpegDir = null }) {
  // ---------- eventos ao vivo (SSE) ----------
  const ouvintes = new Set();
  function publicar(evento, dados) {
    const texto = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const res of ouvintes) res.write(texto);
  }

  // ---------- núcleo ----------
  const nucleo = {
    util,
    ffmpegDir,
    publicar,
    arquivos: criarArquivos(),
    processos: criarProcessos({ publicar, envExtra: ffmpegDir ? { PATH: `${ffmpegDir};${process.env.PATH}` } : {} }),
  };
  const plugins = await carregarPlugins(pastaPlugins, { config, nucleo });
  const ativos = () => plugins.filter((p) => !p.erro && !p.desativado);
  const porId = (id) => ativos().find((p) => p.m.id === id);
  const plugin = (id) => porId(id) || (() => { throw new ErroHttp(404, 'Plugin não encontrado.'); })();

  // Estado de um plugin, com tempo limite: um plugin lento ou com erro não trava o painel.
  async function estadoDe(p) {
    let relogio;
    const limite = new Promise((_, rej) => { relogio = setTimeout(() => rej(new Error('não respondeu a tempo')), 6000); });
    try {
      const e = await Promise.race([p.m.estado(p.ctx), limite]);
      return { ...e, processos: p.ctx.processos.listar() };
    } catch (e) {
      return { status: 'erro', rotulo: 'erro', resumo: e.message, processos: p.ctx.processos.listar() };
    } finally {
      clearTimeout(relogio);
    }
  }

  // Receitas da Visão geral (receitas.json): só as que têm todas as ferramentas ativas. Lido a cada pedido.
  async function receitas() {
    try {
      const { receitas: lista = [] } = JSON.parse(await readFile(path.join(root, 'receitas.json'), 'utf8'));
      return lista.filter((r) => (r.ferramentas || []).every((id) => porId(id)));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`receitas.json: ${e.message}`);
      return [];
    }
  }

  async function estatico(res, arquivo) {
    if (!existsSync(arquivo)) throw new ErroHttp(404, 'Não encontrado.');
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(arquivo));
  }

  const checarPedido = criarChecagem(porta);

  async function rotear(req, res, url) {
    const rota = url.pathname;
    if (req.method === 'GET' && rota === '/') return estatico(res, path.join(root, 'public', 'index.html'));

    // Interface do núcleo (casca + helpers que os plugins importam).
    const core = rota.match(/^\/core\/([\w-][\w.-]*\.(?:js|css|svg))$/);
    if (req.method === 'GET' && core) return estatico(res, path.join(root, 'public', 'core', core[1]));

    // Interface de cada plugin: plugins/<id>/ui.js e plugins/<id>/ui/*.
    const ui = rota.match(/^\/plugins\/([\w-]+)\/(ui\.js|ui\/[\w-][\w.-]*)$/);
    if (req.method === 'GET' && ui) return estatico(res, path.join(plugin(ui[1]).ctx.dir, ui[2]));

    if (req.method === 'GET' && rota === '/api/plugins') {
      return json(res, 200, { plugins: plugins.map(manifestoPublico), receitas: await receitas(), ffmpeg: Boolean(ffmpegDir), animacoes: config.animacoes || 'sempre' });
    }

    if (req.method === 'GET' && rota === '/api/estado') {
      const lista = ativos();
      const estados = await Promise.all(lista.map(estadoDe));
      return json(res, 200, Object.fromEntries(lista.map((p, i) => [p.m.id, estados[i]])));
    }

    const est = rota.match(/^\/api\/plugins\/([\w-]+)\/estado$/);
    if (req.method === 'GET' && est) return json(res, 200, await estadoDe(plugin(est[1])));

    const acao = rota.match(/^\/api\/plugins\/([\w-]+)\/acao$/);
    if (req.method === 'POST' && acao) {
      const p = plugin(acao[1]);
      const { acao: nome, ...params } = await lerCorpo(req);
      // Só ações próprias do plugin: "constructor", "toString" e afins não são ações.
      const fn = typeof nome === 'string' && p.m.acoes && Object.hasOwn(p.m.acoes, nome) ? p.m.acoes[nome] : null;
      if (typeof fn !== 'function') throw new ErroHttp(404, `Ação "${String(nome)}" não existe em ${p.m.nome}.`);
      return json(res, 200, (await fn(params, p.ctx)) ?? { ok: true });
    }

    // Ações do núcleo, iguais para todos os plugins.
    if (req.method === 'POST' && rota === '/api/core') {
      const c = await lerCorpo(req);
      if (c.acao === 'abrirPasta') {
        const p = plugin(c.plugin);
        const dir = typeof c.pasta === 'string' && Object.hasOwn(p.ctx.pastas, c.pasta) ? p.ctx.pastas[c.pasta] : null;
        if (!dir) throw new ErroHttp(404, 'Pasta desconhecida.');
        await nucleo.arquivos.abrirPasta(dir);
      } else if (c.acao === 'mostrar') {
        nucleo.arquivos.mostrar(c.caminho);
      } else if (c.acao === 'cancelar') {
        if (!nucleo.processos.cancelar(c.id)) throw new ErroHttp(404, 'Processo não encontrado ou já terminado.');
      } else {
        throw new ErroHttp(404, 'Ação desconhecida.');
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && rota === '/api/arquivo') {
      return nucleo.arquivos.servir(req, res, url.searchParams.get('caminho'), { baixar: url.searchParams.has('baixar') });
    }

    // Envio de arquivos (vídeos da pessoa) para a pasta que um plugin declara em manifesto.recebe.
    // O cabeçalho X-Painel já foi exigido pela checagem (core/seguranca.mjs).
    if (req.method === 'POST' && rota === '/api/enviar') {
      const p = porId(url.searchParams.get('plugin'));
      const dir = p?.m.recebe && p.ctx.pastas[p.m.recebe.pasta];
      if (!dir) throw new ErroHttp(404, 'Nenhum plugin recebe arquivos aqui.');
      const arquivo = await nucleo.arquivos.receber(req, dir, url.searchParams.get('nome'), p.m.recebe.tipos);
      publicar('plugin', { plugin: p.m.id });
      return json(res, 200, { arquivo });
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

    const certo = METODOS.find(([re]) => re.test(rota));
    if (certo) {
      res.setHeader('Allow', certo[1]);
      throw new ErroHttp(405, 'Método não permitido.');
    }
    throw new ErroHttp(404, 'Não encontrado.');
  }

  const servidor = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(CABECALHOS)) res.setHeader(k, v);
    let url;
    try {
      url = new URL(req.url, `http://127.0.0.1:${porta}`);
    } catch {
      return json(res, 400, { erro: 'Endereço inválido.' });
    }
    const barrado = checarPedido(req, url.pathname);
    if (barrado) {
      // Não lê o corpo (pode ser um vídeo inteiro): responde e fecha a conexão.
      if (!req.complete) res.setHeader('Connection', 'close');
      return json(res, barrado[0], { erro: barrado[1] });
    }
    try {
      await rotear(req, res, url);
    } catch (e) {
      responderErro(res, e, `${req.method} ${url.pathname}`);
    }
  });

  async function encerrar() {
    nucleo.processos.encerrarTodos();
    for (const p of ativos()) await Promise.resolve(p.m.encerrar?.(p.ctx)).catch(() => {});
    for (const res of ouvintes) res.end();
    await new Promise((ok) => servidor.close(ok));
  }

  return { servidor, plugins, nucleo, encerrar };
}
