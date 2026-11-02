// Utilidades do núcleo, disponíveis para todos os plugins via ctx.util.

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export function json(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

export async function lerCorpo(req) {
  let dados = '';
  for await (const parte of req) {
    dados += parte;
    if (dados.length > 1e5) throw new Error('Corpo grande demais');
  }
  return dados ? JSON.parse(dados) : {};
}

export function portaAberta(porta, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ host, port: porta });
    const fim = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(300, () => fim(false));
    s.on('connect', () => fim(true));
    s.on('error', () => fim(false));
  });
}

export function portaLivre(inicio) {
  return new Promise((resolve) => {
    const tentar = (porta) => {
      const s = net.createServer();
      s.once('error', () => tentar(porta + 1));
      s.once('listening', () => s.close(() => resolve(porta)));
      s.listen(porta, '127.0.0.1');
    };
    tentar(inicio);
  });
}

// GET em JSON com tempo limite (para conectores que falam com outros apps locais).
export async function buscarJson(url, { timeout = 2500, ...opcoes } = {}) {
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), timeout);
  try {
    const r = await fetch(url, { ...opcoes, signal: controle.signal });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo.erro || `HTTP ${r.status}`);
    return corpo;
  } finally {
    clearTimeout(t);
  }
}

export function processoRodando(imagem) {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${imagem}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) =>
      resolve(!err && out.toLowerCase().includes(imagem.toLowerCase())));
  });
}

export function abrirNoExplorer(alvo, selecionar = false) {
  spawn('explorer.exe', [selecionar ? `/select,${alvo}` : alvo], { detached: true }).unref();
}

export function slug(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

export const carimbo = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

// FFmpeg pode não estar no PATH de um shell aberto antes da instalação pelo winget.
export function acharFfmpeg() {
  try {
    const primeiro = execFileSync('where', ['ffmpeg'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).find(Boolean);
    if (primeiro) return path.dirname(primeiro);
  } catch {}
  const winget = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of execFileSync('cmd', ['/c', 'dir', '/b', winget], { encoding: 'utf8' }).split(/\r?\n/)) {
      if (!pkg.startsWith('Gyan.FFmpeg')) continue;
      for (const sub of execFileSync('cmd', ['/c', 'dir', '/b', path.join(winget, pkg)], { encoding: 'utf8' }).split(/\r?\n/)) {
        const bin = path.join(winget, pkg, sub, 'bin');
        if (sub && existsSync(path.join(bin, 'ffmpeg.exe'))) return bin;
      }
    }
  } catch {}
  return null;
}
