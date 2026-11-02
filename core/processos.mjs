// Gerenciador de processos longos (renders, prévias, CLIs). Cada plugin recebe uma versão
// "com escopo" (ctx.processos) que marca o processo com o id do plugin.

import { spawn } from 'node:child_process';

const semAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

export function criarProcessos({ publicar, envExtra = {} }) {
  const processos = new Map();
  let proximoId = 1;

  const resumo = ({ proc, ...resto }) => resto;
  const avisar = (p) => publicar('processo', resumo(p));

  // lerLinha(linha, p) permite ao plugin extrair progresso/URL do log; aoTerminar(p, code) roda no fim.
  function iniciar({ plugin, tipo, titulo, comando, args = [], cwd, env, alvo, dados, url, lerLinha, aoTerminar }) {
    const p = {
      id: proximoId++, plugin, tipo, titulo, alvo: alvo ?? null, dados: dados ?? null,
      estado: 'rodando', progresso: null, url: url ?? null, log: [], inicio: Date.now(), fim: null, erro: null,
    };
    processos.set(p.id, p);
    const proc = spawn(comando, args, {
      cwd, windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...envExtra, ...env },
    });
    p.proc = proc;

    let resto = '';
    const consumir = (d) => {
      resto += semAnsi(String(d));
      const linhas = resto.split(/\r?\n|\r/);
      resto = linhas.pop();
      for (const linha of linhas.map((l) => l.trimEnd()).filter(Boolean)) {
        p.log.push(linha);
        if (p.log.length > 300) p.log.shift();
        const pct = linha.match(/(\d{1,3}(?:\.\d+)?)\s?%/);
        if (pct && Number(pct[1]) <= 100) p.progresso = Number(pct[1]);
        lerLinha?.(linha, p);
      }
      avisar(p);
    };
    proc.stdout.on('data', consumir);
    proc.stderr.on('data', consumir);
    proc.on('error', (e) => {
      p.estado = 'erro';
      p.erro = e.message;
      p.fim = Date.now();
      avisar(p);
    });
    proc.on('close', (code) => {
      delete p.proc;
      p.fim = Date.now();
      if (p.estado !== 'cancelado') {
        if (code === 0) {
          p.estado = 'concluido';
          if (p.progresso !== null) p.progresso = 100;
        } else {
          p.estado = 'erro';
          p.erro = p.log.slice(-3).join(' · ') || `saiu com código ${code}`;
        }
      }
      aoTerminar?.(p, code);
      avisar(p);
    });
    avisar(p);
    return resumo(p);
  }

  function cancelar(id) {
    const p = processos.get(Number(id));
    if (!p?.proc) return false;
    p.estado = 'cancelado';
    spawn('taskkill', ['/pid', String(p.proc.pid), '/t', '/f'], { windowsHide: true });
    return true;
  }

  // Escreve na entrada do processo (ex.: o Enter que um CLI espera depois de uma autorização no navegador).
  function enviar(id, texto, plugin) {
    const p = processos.get(Number(id));
    if (!p?.proc?.stdin?.writable || (plugin && p.plugin !== plugin)) return false;
    p.proc.stdin.write(texto);
    avisar(p);
    return true;
  }

  const listar = (plugin) => [...processos.values()].filter((p) => !plugin || p.plugin === plugin).map(resumo).reverse();
  const ativos = (plugin) => listar(plugin).filter((p) => p.estado === 'rodando');

  function encerrarTodos() {
    for (const p of processos.values()) if (p.proc) spawn('taskkill', ['/pid', String(p.proc.pid), '/t', '/f'], { windowsHide: true });
  }

  // Versão entregue a cada plugin: não precisa repetir o próprio id.
  function comEscopo(plugin) {
    return {
      iniciar: (opcoes) => iniciar({ ...opcoes, plugin }),
      cancelar,
      enviar: (id, texto) => enviar(id, texto, plugin),
      obter: (id) => listar(plugin).find((p) => p.id === Number(id)) ?? null,
      listar: () => listar(plugin),
      ativos: () => ativos(plugin),
    };
  }

  return { iniciar, cancelar, enviar, listar, ativos, encerrarTodos, comEscopo };
}
