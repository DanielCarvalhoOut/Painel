// Acesso a arquivos com lista de pastas permitidas. Cada plugin declara as suas (manifesto.pastas);
// nada fora delas pode ser listado, aberto ou servido para o player.
// A comparação é feita no caminho REAL (realpath): "..", nomes curtos 8.3 (PROGRA~1), junções e links
// simbólicos são resolvidos antes, então uma junção dentro de uma pasta permitida que aponta para fora não
// abre a porta. Caminhos de dispositivo (\\?\, \\.\), fluxos alternativos do NTFS (arquivo.mp4:oculto) e
// byte nulo são recusados de saída.

import { readdir, stat, mkdir, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync, realpathSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { json, abrirNoExplorer, ErroHttp } from './util.mjs';

const WIN = process.platform === 'win32';
const comparavel = (c) => (WIN ? c.toLowerCase() : c);

// Caminho real de `alvo`, ou null se ele não puder ser usado com segurança. Para algo que ainda não existe
// (o destino de um envio), resolve a parte que existe e junta o resto.
export function caminhoReal(alvo) {
  if (typeof alvo !== 'string' || !alvo || alvo.includes('\0')) return null;
  if (/^[\\/]{2}[?.][\\/]/.test(alvo)) return null;
  let abs = path.resolve(alvo);
  if (WIN && abs.slice(2).includes(':')) return null;
  const resto = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(abs), ...resto.reverse());
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return null;
      const pai = path.dirname(abs);
      if (pai === abs) return null;
      resto.push(path.basename(abs));
      abs = pai;
    }
  }
}

// Nomes que o Windows trata como dispositivo em qualquer pasta (CON.mp4 não é um arquivo).
export const nomeReservado = (nome) => /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\.|$)/i.test(path.basename(String(nome)));

export const EXT = {
  video: ['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.gif'],
  audio: ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.opus'],
  legenda: ['.srt', '.vtt', '.json'],
  imagem: ['.png', '.jpg', '.jpeg', '.webp'],
  modelo3d: ['.glb', '.blend'],
};
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary',
};

export function tipoDe(nome) {
  const ext = path.extname(nome).toLowerCase();
  return Object.keys(EXT).find((t) => EXT[t].includes(ext)) || 'outro';
}

export function criarArquivos() {
  const raizes = new Set();

  const dentroDe = (alvo, raiz) => {
    const a = caminhoReal(alvo);
    const r = caminhoReal(raiz);
    if (!a || !r) return false;
    const [ca, cr] = [comparavel(a), comparavel(r)];
    return ca === cr || ca.startsWith(cr.endsWith(path.sep) ? cr : cr + path.sep);
  };
  const permitido = (alvo) => [...raizes].some((r) => dentroDe(alvo, r));

  // Lista arquivos de uma pasta (não recursivo). tipos: ['video','audio',...] filtra por extensão.
  // Links simbólicos e junções ficam de fora (Dirent.isFile/isDirectory é falso para eles).
  async function listar(dir, tipos) {
    const exts = tipos?.flatMap((t) => EXT[t] || []);
    try {
      const itens = await readdir(dir, { withFileTypes: true });
      const lista = [];
      for (const it of itens) {
        if (!it.isFile() || it.name.startsWith('.')) continue;
        if (exts && !exts.includes(path.extname(it.name).toLowerCase())) continue;
        const caminho = path.join(dir, it.name);
        const st = await stat(caminho).catch(() => null);
        if (st) lista.push({ nome: it.name, caminho, tamanho: st.size, modificado: st.mtimeMs, tipo: tipoDe(it.name) });
      }
      return lista.sort((a, b) => b.modificado - a.modificado);
    } catch {
      return [];
    }
  }

  async function listarPastas(dir) {
    try {
      const itens = await readdir(dir, { withFileTypes: true });
      const lista = [];
      for (const it of itens) {
        if (!it.isDirectory() || it.name.startsWith('.')) continue;
        const caminho = path.join(dir, it.name);
        const st = await stat(caminho).catch(() => null);
        lista.push({ nome: it.name, caminho, modificado: st?.mtimeMs || 0 });
      }
      return lista.sort((a, b) => b.modificado - a.modificado);
    } catch {
      return [];
    }
  }

  async function abrirPasta(dir) {
    if (!permitido(dir)) throw new ErroHttp(403, 'Pasta fora das pastas do painel.');
    await mkdir(dir, { recursive: true });
    abrirNoExplorer(caminhoReal(dir));
  }

  function mostrar(caminho) {
    if (!permitido(caminho)) throw new ErroHttp(403, 'Arquivo fora das pastas do painel.');
    const real = caminhoReal(caminho);
    if (!existsSync(real)) throw new ErroHttp(404, 'Arquivo não encontrado.');
    abrirNoExplorer(real, true);
  }

  // Recebe um arquivo enviado pelo navegador direto para `dir`, aos poucos (vídeo grande não passa pela memória).
  // Grava como ".nome.parcial" (oculto e com extensão que ninguém processa) e só renomeia no fim, para o
  // notebook de transcrição ou o HyperFrames nunca pegarem um vídeo pela metade. Não sobrescreve: "nome (2).mp4".
  async function receber(req, pasta, nomeOriginal, tipos) {
    if (!permitido(pasta)) throw new ErroHttp(403, 'Pasta fora das pastas do painel.');
    const base = path.basename(String(nomeOriginal || '').replace(/\\/g, '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 200);
    const { name, ext } = path.parse(base);
    if (!name || !(tipos || Object.keys(EXT)).some((t) => EXT[t]?.includes(ext.toLowerCase()))) {
      throw new ErroHttp(400, `Formato não aceito: ${ext || 'sem extensão'}. Envie ${(tipos || Object.keys(EXT)).flatMap((t) => EXT[t]).join(', ')}.`);
    }
    if (nomeReservado(base)) throw new ErroHttp(400, `"${base}" é um nome reservado do Windows. Renomeie o arquivo.`);
    await mkdir(pasta, { recursive: true });
    const dir = caminhoReal(pasta);
    if (!dir || !permitido(dir)) throw new ErroHttp(403, 'Pasta fora das pastas do painel.');
    const parcial = path.join(dir, `.${base}.${process.pid}-${Date.now()}.parcial`);
    try {
      await pipeline(req, createWriteStream(parcial));
      if (req.readableAborted || (req.headers['content-length'] && (await stat(parcial)).size !== Number(req.headers['content-length']))) {
        throw new ErroHttp(400, 'O envio foi interrompido.');
      }
      let final = path.join(dir, base);
      for (let n = 2; existsSync(final); n++) final = path.join(dir, `${name} (${n})${ext}`);
      await rename(parcial, final);
      const st = await stat(final);
      return { nome: path.basename(final), caminho: final, tamanho: st.size, modificado: st.mtimeMs, tipo: tipoDe(final) };
    } catch (e) {
      await rm(parcial, { force: true }).catch(() => {});
      throw e;
    }
  }

  // Serve um arquivo com suporte a Range (o <video> precisa para avançar e voltar). baixar=true: vai como download.
  async function servir(req, res, pedido, { baixar = false } = {}) {
    if (!permitido(pedido)) return json(res, 403, { erro: 'Arquivo fora das pastas do painel.' });
    const caminho = caminhoReal(pedido); // daqui em diante só o caminho real, já conferido
    const st = await stat(caminho).catch(() => null);
    if (!st?.isFile()) return json(res, 404, { erro: 'Arquivo não encontrado.' });
    const tipo = MIME[path.extname(caminho).toLowerCase()] || 'application/octet-stream';
    if (baixar) {
      const nome = path.basename(caminho);
      res.writeHead(200, {
        'Content-Type': tipo, 'Content-Length': st.size,
        'Content-Disposition': `attachment; filename="${nome.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      });
      return createReadStream(caminho).pipe(res);
    }
    const faixa = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (faixa) {
      const inicio = faixa[1] ? Number(faixa[1]) : Math.max(0, st.size - Number(faixa[2]));
      const fim = faixa[1] && faixa[2] ? Math.min(Number(faixa[2]), st.size - 1) : st.size - 1;
      if (inicio >= st.size || fim < inicio) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { 'Content-Type': tipo, 'Content-Length': fim - inicio + 1, 'Content-Range': `bytes ${inicio}-${fim}/${st.size}`, 'Accept-Ranges': 'bytes' });
      return createReadStream(caminho, { start: inicio, end: fim }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    createReadStream(caminho).pipe(res);
  }

  return {
    permitir: (dir) => raizes.add(path.resolve(dir)),
    permitido, dentroDe, listar, listarPastas, abrirPasta, mostrar, servir, receber,
  };
}
