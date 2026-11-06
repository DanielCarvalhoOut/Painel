// Serviço Colab: acompanha os notebooks que rodam no Google Colab. Não há conexão direta — cada
// notebook grava um JSON de status em _colab/status no Drive, e o Drive para desktop traz para cá.
// Formato do status: ver notebooks/LEIAME.md (servico, estado, etapa, progresso, log, gpu, ram…).

//
// Com o Colab CLI oficial (pasta colab-cli, roda pelo WSL) o Painel também liga a VM, executa o notebook
// e desliga sozinho, sem abrir o navegador. O andamento continua chegando pelo mesmo JSON de status.
//
// Máquinas e perfis (maquinas.mjs): cada tarefa roda na máquina que o perfil ativo manda. Uma máquina pode
// ficar ligada uns minutos depois da tarefa para a próxima aproveitar; quem desliga é o cronômetro daqui,
// que fica gravado em colab-cli/_estado.json para sobreviver a um reinício do Painel.

import { readFile, mkdir, copyFile, appendFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAQUINAS, TAREFAS, OPCOES, lerPerfis, gravarJson, normalizarPerfil, nomeSessao, argsMaquina, nomeDeMidia } from './maquinas.mjs';

const PAINEL = path.resolve(fileURLToPath(import.meta.url), '../../..');
const QUALIDADES = ['draft', 'looks', 'delivery'];
const ARQ_PERFIS = path.join(PAINEL, 'colab-perfis.json');

// D:\EditorVideosFoto\x → /mnt/d/EditorVideosFoto/x (caminho visto de dentro do WSL).
const noWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
const cliInstalado = (ctx) => existsSync(path.join(ctx.config.cli, 'bin', 'colab'));
const arqEstado = (ctx) => path.join(ctx.config.cli, '_estado.json');
const arqTokenHF = (ctx) => path.join(ctx.config.cli, '_segredos', 'hf_token');
// O tar do Windows 10+ (bsdtar) abre .zip. Caminho fixo: o tar do Git Bash, se vier antes no PATH, lê D: como host remoto.
const extrairZip = (zip, destino) => new Promise((ok, falha) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', destino], { windowsHide: true }, (e) => (e ? falha(e) : ok())));

// Estado vivo do plugin (um Painel por vez).
const mem = {
  perfis: null,          // { padrao, perfis: { id: { nome, tarefas } } }
  ativo: null,           // perfil em uso agora; começa no padrão a cada inicialização
  mantidas: new Map(),   // sessão → { sessao, maquina, desligarEm }
  cronometros: new Map(),
  ligadas: [],           // sessões editorvideos-* que o Colab diz estarem ligadas
  conferidoEm: 0,
  saldo: null,
  historico: [],         // últimas execuções com o gasto medido
  hf: { conferidoEm: null }, // última conferência do token do Hugging Face (usuário e acesso ao DINOv3)
};

// Na primeira montagem do Drive o CLI escreve "REQUIRED: Google Drive Authorization needed", o link numa
// linha própria e espera um Enter. Guardamos o link em p.dados para a aba mostrar os botões.
function lerAutorizacao(linha, p) {
  if (/Google Drive Authorization needed/i.test(linha)) p.dados = { ...p.dados, autorizarDrive: true };
  else if (p.dados?.autorizarDrive === true && /^https:\/\/\S+$/.test(linha)) p.dados = { ...p.dados, autorizarDrive: linha };
  else if (/\[colab\] Authorizing VM/i.test(linha) && p.dados?.autorizarDrive) p.dados = { ...p.dados, autorizarDrive: null };
  // Login: o CLI mostra o link do Google (linha própria, com recuo) e espera o código na entrada.
  else if (p.tipo === 'login' && /^\s*https:\/\/accounts\.google\.com\/\S+$/.test(linha)) p.dados = { ...p.dados, loginUrl: linha.trim() };
}

// Linhas do rodar.sh com saldo e destino da sessão.
function lerRodar(linha, p) {
  lerAutorizacao(linha, p);
  const saldo = linha.match(/^\[rodar\] saldo (antes|depois): ([\d.]+)/);
  if (saldo) {
    p.dados = { ...p.dados, [saldo[1] === 'antes' ? 'saldoAntes' : 'saldoDepois']: Number(saldo[2]) };
    mem.saldo = Number(saldo[2]);
  }
  if (/^\[rodar\] sessão \S+ mantida ligada/.test(linha)) p.dados = { ...p.dados, mantida: true };
}

const args = (ctx, script, resto) => ['-d', ctx.config.distro, '--', 'bash', noWsl(path.join(ctx.config.cli, script)), ...resto];

// Roda colab-cli/<script> no WSL; o processo aparece na aba com o log do CLI.
function wsl(ctx, script, resto, extra) {
  if (!cliInstalado(ctx)) throw new Error('Colab CLI não instalado: rode colab-cli/instalar.sh no WSL (ver README).');
  return ctx.processos.iniciar({ comando: 'wsl.exe', args: args(ctx, script, resto), lerLinha: lerRodar, ...extra });
}

// Chamada curta ao rodar.sh sem aparecer como processo (sessões, saldo).
function wslRapido(ctx, resto, timeout = 90000) {
  return new Promise((resolve) => {
    if (!cliInstalado(ctx)) return resolve(null);
    execFile('wsl.exe', args(ctx, 'rodar.sh', resto), { windowsHide: true, timeout }, (err, out) => resolve(err ? null : String(out)));
  });
}

// ---------- sessões mantidas ligadas ----------
async function gravarEstado(ctx) {
  await gravarJson(arqEstado(ctx), { mantidas: [...mem.mantidas.values()] }).catch((e) => ctx.log('estado:', e.message));
}

function armar(ctx, m) {
  clearTimeout(mem.cronometros.get(m.sessao));
  mem.cronometros.set(m.sessao, setTimeout(() => desligarSessao(ctx, m.sessao, 'o tempo de manter ligada acabou'), Math.max(0, m.desligarEm - Date.now())));
}

function soltar(ctx, sessao) {
  clearTimeout(mem.cronometros.get(sessao));
  mem.cronometros.delete(sessao);
  if (mem.mantidas.delete(sessao)) gravarEstado(ctx);
}

function desligarSessao(ctx, sessao, motivo) {
  soltar(ctx, sessao);
  if (!cliInstalado(ctx)) return;
  ctx.processos.iniciar({
    comando: 'wsl.exe', args: args(ctx, 'rodar.sh', ['parar', sessao]),
    tipo: 'desligar', titulo: `Desligar ${sessao}${motivo ? ` (${motivo})` : ''}`, alvo: sessao,
    aoTerminar: () => conferirSessoes(ctx),
  });
}

// Pergunta ao Colab quais sessões do Painel estão ligadas. Uma ligada sem tarefa e sem cronômetro é sobra
// (Painel fechado de repente, cancelamento no meio): a aba avisa e oferece desligar.
async function conferirSessoes(ctx) {
  const out = await wslRapido(ctx, ['sessoes']);
  if (out === null) return;
  mem.ligadas = out.split(/\r?\n/).map((l) => l.match(/^(editorvideos-[a-z0-9-]+) \| (.*)$/)).filter(Boolean)
    .map((m) => ({ sessao: m[1], hardware: m[2].trim() }));
  mem.conferidoEm = Date.now();
  // Cronômetro de uma sessão que já não existe não serve para nada.
  for (const s of mem.mantidas.keys()) if (!mem.ligadas.some((l) => l.sessao === s)) soltar(ctx, s);
  ctx.publicar('plugin', {});
}

// ---------- tarefas na nuvem ----------
// Perfil pelo id, só entre os próprios (um id como "constructor" ou "__proto__" não é perfil).
const perfilDe = (id) => (typeof id === 'string' && Object.hasOwn(mem.perfis.perfis, id) ? mem.perfis.perfis[id] : null);
const perfilAtivo = () => perfilDe(mem.ativo) || Object.values(mem.perfis.perfis)[0];

function tarefaNaNuvem(ctx, tipo, perfilId, resto, extra) {
  if (ctx.processos.ativos().some((p) => TAREFAS[p.tipo])) throw new Error('Já tem uma tarefa rodando no Colab. Espere terminar ou cancele.');
  const perfil = perfilDe(perfilId) || perfilAtivo();
  const t = perfil.tarefas[tipo];
  const sessao = nomeSessao(t);
  // A sessão vai ser usada agora: o cronômetro de desligar para até a tarefa terminar.
  clearTimeout(mem.cronometros.get(sessao));
  let vigia;
  const p = wsl(ctx, 'rodar.sh', [...argsMaquina(t), tipo, ...resto], {
    ...extra,
    tipo,
    titulo: `${extra.titulo} · ${MAQUINAS[t.maquina].nome}`,
    dados: { maquina: t.maquina, sessao, perfil: perfil.nome },
    aoTerminar: async (fim) => {
      clearTimeout(vigia);
      // Matar o wsl.exe não garante que a VM caiu: cancelamento e erro desligam a sessão explicitamente.
      if (fim.estado !== 'concluido') desligarSessao(ctx, sessao, fim.estado === 'cancelado' ? 'tarefa cancelada' : 'tarefa com erro');
      else if (fim.dados?.mantida && t.manterMin > 0) {
        const m = { sessao, maquina: t.maquina, desligarEm: Date.now() + t.manterMin * 60000 };
        mem.mantidas.set(sessao, m);
        armar(ctx, m);
        gravarEstado(ctx);
      } else soltar(ctx, sessao);
      await registrar(ctx, fim, t);
      await extra.aoTerminar?.(fim);
      conferirSessoes(ctx);
    },
  });
  // Vigia: se a tarefa passar do limite (mais uma folga para ligar a VM e baixar), derruba e desliga.
  vigia = setTimeout(() => ctx.processos.cancelar(p.id), (t.limiteMin + 15) * 60000);
  return p;
}

// Histórico com o gasto medido (saldo antes − depois) e o log inteiro de cada execução, em arquivo.
async function registrar(ctx, p, t) {
  const gasto = p.dados?.saldoAntes != null && p.dados?.saldoDepois != null ? Math.max(0, +(p.dados.saldoAntes - p.dados.saldoDepois).toFixed(2)) : null;
  const item = { id: p.id, tipo: p.tipo, titulo: p.titulo, maquina: t.maquina, estado: p.estado, inicio: p.inicio, fim: p.fim, gasto, erro: p.erro };
  mem.historico = [item, ...mem.historico].slice(0, 30);
  try {
    await appendFile(path.join(ctx.config.cli, '_historico.jsonl'), `${JSON.stringify(item)}\n`);
    const dir = path.join(ctx.config.cli, '_logs');
    await mkdir(dir, { recursive: true });
    const quando = new Date(p.inicio).toISOString().slice(0, 19).replace(/[-:T]/g, '');
    await writeFile(path.join(dir, `${quando}-${p.tipo}-${p.id}.log`), `${p.titulo}\nestado: ${p.estado}${p.erro ? `\nerro: ${p.erro}` : ''}\n\n${(p.log || []).join('\n')}\n`);
  } catch (e) {
    ctx.log('histórico:', e.message);
  }
}

async function lerHistorico(ctx) {
  try {
    const linhas = (await readFile(path.join(ctx.config.cli, '_historico.jsonl'), 'utf8')).trim().split('\n').slice(-30);
    mem.historico = linhas.map((l) => JSON.parse(l)).reverse();
  } catch {}
}

// Etapa de um processo do CLI lida do próprio log, para o ícone flutuante e o cartão. O JSON de status
// só aparece depois que o notebook começa (e o Drive ainda leva um tempo para trazê-lo ao PC).
const TITULOS_CLI = { transcrever: 'transcrição no Colab', renderizar: 'render no Colab', voz: 'narração no Colab', blender: '3D no Colab', ia3d: '3D por IA no Colab', login: 'login', desligar: 'desligando VM' };
function etapaCli(p) {
  if (p.dados?.autorizarDrive) return { detalhe: 'esperando você autorizar o Drive', atencao: true };
  if (p.tipo === 'login') return { detalhe: p.dados?.loginUrl ? 'esperando o código de login' : 'gerando o link', atencao: !!p.dados?.loginUrl };
  for (let i = p.log.length - 1; i >= 0; i--) {
    const l = p.log[i];
    const celula = l.match(/Executing cell (\d+)\/(\d+) - (.*?)\.*$/);
    if (celula) return { detalhe: `célula ${celula[1]}/${celula[2]} · ${celula[3].replace(/^\d+\.\s*/, '')}`, progresso: Math.round(((celula[1] - 1) / celula[2]) * 100) };
    if (/Saving notebook|\[rodar\] concluído|mantida ligada/.test(l)) return { detalhe: 'terminando', progresso: 100 };
    if (/enviando a voz de referência/.test(l)) return { detalhe: 'enviando a voz de referência' };
    if (/Mounting Google Drive|Authorizing VM|Credentials propagated|montando o Google Drive/.test(l)) return { detalhe: 'montando o Google Drive' };
    if (/reaproveitando a sessão/.test(l)) return { detalhe: 'usando a máquina que estava ligada' };
    if (/criando sessão|Creating session|Session READY/.test(l)) return { detalhe: 'ligando a VM no Colab' };
  }
  return { detalhe: 'começando' };
}

async function servicos(ctx) {
  const limite = (ctx.config.semSinalAposSegundos || 120) * 1000;
  const lista = [];
  for (const a of await ctx.arquivos.listar(ctx.pastas.status)) {
    if (!a.nome.endsWith('.json')) continue;
    try {
      const s = JSON.parse(await readFile(a.caminho, 'utf8'));
      const idade = Date.now() - (s.atualizado || a.modificado);
      // Rodando, mas sem sinal: a sessão do Colab caiu, desconectou ou travou.
      if (s.estado === 'rodando' && idade > limite) s.estado = 'sem-sinal';
      lista.push({ ...s, idade, arquivo: a.caminho });
    } catch {}
  }
  return lista.sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
}

function estadoMaquinas(ctx) {
  const emUso = new Set(ctx.processos.ativos().map((p) => p.dados?.sessao).filter(Boolean));
  return {
    catalogo: MAQUINAS,
    tarefas: TAREFAS,
    opcoes: OPCOES,
    perfis: mem.perfis.perfis,
    padrao: mem.perfis.padrao,
    ativo: mem.ativo,
    saldo: mem.saldo,
    conferidoEm: mem.conferidoEm,
    ligadas: mem.ligadas.map((l) => ({
      ...l,
      desligarEm: mem.mantidas.get(l.sessao)?.desligarEm ?? null,
      emUso: emUso.has(l.sessao),
      sobra: !emUso.has(l.sessao) && !mem.mantidas.has(l.sessao),
    })),
    historico: mem.historico.slice(0, 8),
  };
}

export default {
  id: 'colab',
  nome: 'Colab',
  logo: 'logo.svg',
  icone: '[☁︎]',
  descricao: 'Transcrição (Whisper), narração e render pesados na GPU/CPU do Google Colab.',
  tipo: 'servico',
  ordem: 20,
  papel: 'Força na nuvem',
  perfil: {
    forte: 'O trabalho pesado que o PC não aguenta, numa máquina do Google que você escolhe, ligada e desligada sozinha.',
    usos: ['transcrição de qualidade (Whisper large)', 'narração com voz natural', 'render longo ou em qualidade final', 'qualquer notebook que precise de GPU'],
    naoE: 'criar ou editar; é o motor, não o estúdio',
  },
  flutuante: true,  // pode mostrar o andamento num ícone flutuante nas outras abas
  usar: [{
    rotulo: 'transcrever na GPU', acao: 'transcrever', descricao: 'Whisper numa GPU do Colab; o texto vira as legendas.',
    aviso: 'O Colab só vê o vídeo depois que o Drive termina de subir (ícone do Google Drive na bandeja). Vídeo grande: espere a sincronização.',
  }],
  padroes: (g) => ({
    drive: path.join(g.drive, '_colab'), vozes: path.join(g.drive, 'HyperFrames', 'voz'),
    semSinalAposSegundos: 120, cli: path.join(PAINEL, 'colab-cli'), distro: 'Ubuntu',
    // Scripts 3D e saída do plugin Blender (o render no Colab devolve o resultado para lá).
    blender: path.join(g.ferramentas, 'Blender'),
  }),
  pastas: (cfg) => ({
    status: path.join(cfg.drive, 'status'), notebooks: path.join(cfg.drive, 'notebooks'),
    // Narrações geradas (3_voz) e gravações de referência para a voz própria.
    voz: cfg.vozes, referencia: path.join(cfg.vozes, 'referencia'),
  }),

  async iniciar(ctx) {
    mem.perfis = await lerPerfis(ARQ_PERFIS);
    mem.ativo = mem.perfis.padrao;
    await lerHistorico(ctx);
    // Cronômetros de sessões mantidas que sobreviveram a um reinício: vencido desliga já, o resto volta a contar.
    try {
      const { mantidas = [] } = JSON.parse(await readFile(arqEstado(ctx), 'utf8'));
      for (const m of mantidas) {
        if (!/^editorvideos-[a-z0-9-]+$/.test(m.sessao)) continue;
        mem.mantidas.set(m.sessao, m);
        if (m.desligarEm <= Date.now()) desligarSessao(ctx, m.sessao, 'o tempo acabou com o Painel fechado');
        else armar(ctx, m);
      }
    } catch {}
    // Sem esperar: o WSL e o Colab demoram uns segundos para responder.
    wslRapido(ctx, ['saldo']).then((out) => {
      const s = out?.match(/saldo: ([\d.]+)/);
      if (s) mem.saldo = Number(s[1]);
    });
    conferirSessoes(ctx);
    if (!existsSync(path.parse(ctx.config.drive).root)) return;
    await Promise.all(Object.values(ctx.pastas).map((d) => mkdir(d, { recursive: true }).catch(() => {})));
  },

  // Painel fechando: máquina mantida ligada não fica gastando sem ninguém olhando.
  async encerrar(ctx) {
    await Promise.all([...mem.mantidas.keys()].map((s) => wslRapido(ctx, ['parar', s], 60000)));
    mem.mantidas.clear();
    await gravarEstado(ctx);
  },

  async estado(ctx) {
    const drive = existsSync(path.parse(ctx.config.drive).root);
    const [lista, notebooks, vozes, referencias] = await Promise.all([
      servicos(ctx),
      ctx.arquivos.listar(ctx.pastas.notebooks).then((l) => l.filter((a) => a.nome.endsWith('.ipynb'))),
      ctx.arquivos.listar(ctx.pastas.voz, ['audio']),
      ctx.arquivos.listar(ctx.pastas.referencia, ['audio']),
    ]);
    // Com máquina mantida ou sobra, confere de novo a cada 2 min se continuam ligadas.
    if ((mem.mantidas.size || mem.ligadas.length) && Date.now() - mem.conferidoEm > 120000) {
      mem.conferidoEm = Date.now();
      conferirSessoes(ctx);
    }
    const rodando = lista.filter((s) => s.estado === 'rodando');
    const semSinal = lista.filter((s) => s.estado === 'sem-sinal');
    const gpu = rodando.find((s) => s.gpu?.nome)?.gpu;
    const cli = ctx.processos.ativos();
    const maquinas = estadoMaquinas(ctx);
    const sobras = maquinas.ligadas.filter((l) => l.sobra);
    return {
      status: !drive ? 'erro' : semSinal.length || sobras.length ? 'aviso' : rodando.length || cli.length || mem.mantidas.size ? 'ok' : 'off',
      rotulo: !drive ? 'sem Drive' : rodando.length || cli.length ? `rodando ${rodando.length || cli.length}`
        : sobras.length ? 'VM ligada à toa' : mem.mantidas.size ? 'VM ligada' : semSinal.length ? 'sem sinal' : 'ocioso',
      resumo: !drive ? 'O Google Drive (G:) não está montado; o Painel não vê o Colab.' : null,
      metricas: [
        ['Perfil', perfilAtivo().nome],
        ['Rodando', String(rodando.length || cli.length)],
        ['GPU', gpu ? gpu.nome : '—'],
        ['Saldo', mem.saldo != null ? `${mem.saldo.toFixed(1)} un.` : '—'],
        ['Colab CLI', cliInstalado(ctx) ? 'instalado' : '—'],
      ],
      cli: cliInstalado(ctx),
      atalhos: cliInstalado(ctx) && !ctx.processos.ativos().length ? [{ acao: 'transcrever', rotulo: '[>] transcrever na GPU' }] : [],
      ocupado: rodando.length > 0 || cli.length > 0,
      // O que o ícone flutuante mostra enquanto um notebook roda (ou perdeu o sinal).
      flutuante: (() => {
        // Processo do CLI rodando: o status do notebook vale só se for desta rodada (gravado depois do início);
        // antes disso (VM ligando, Drive montando, Drive do PC atrasado) a etapa vem do log do CLI.
        const p = cli[0];
        const s = rodando.find((x) => !p || (x.atualizado || 0) >= p.inicio - 60000) || (!p && semSinal[0]);
        if (s && !(p && etapaCli(p).atencao)) {
          return { titulo: s.servico, detalhe: s.etapa || s.mensagem || '', progresso: s.progresso ?? null, estado: s.estado, extra: rodando.length > 1 ? `+${rodando.length - 1}` : '' };
        }
        if (!p) return null;
        const e = etapaCli(p);
        return { titulo: TITULOS_CLI[p.tipo] || p.titulo, detalhe: e.detalhe, progresso: e.progresso ?? null, estado: e.atencao ? 'rodando atencao' : 'rodando', extra: cli.length > 1 ? `+${cli.length - 1}` : '' };
      })(),
      atividade: lista.slice(0, 6).map((s) => ({
        titulo: `${s.servico}${s.etapa ? ` — ${s.etapa}` : ''}`,
        estado: s.estado,
        progresso: s.progresso ?? null,
        detalhe: s.mensagem || '',
        quando: s.atualizado,
      })),
      servicos: lista,
      notebooks, vozes, referencias,
      maquinas,
    };
  },

  acoes: {
    // Transcreve o que estiver novo em HyperFrames/entrada (ou só `arquivo`) na máquina do perfil.
    async transcrever({ arquivo, perfil } = {}, ctx) {
      // O nome vai para o notebook como variável de ambiente: só um vídeo/áudio de HyperFrames/entrada, sem pastas.
      if (arquivo && !nomeDeMidia(arquivo)) throw new Error('Arquivo inválido: use o nome de um vídeo ou áudio de HyperFrames/entrada.');
      tarefaNaNuvem(ctx, 'transcrever', perfil, arquivo ? [String(arquivo)] : [], { titulo: 'Transcrever', alvo: arquivo || 'entrada' });
      return { mensagem: 'Ligando a máquina no Colab…' };
    },

    // Renderiza uma composição no Colab (CPU com RAM alta no perfil de fábrica).
    async renderizar({ composicao, qualidade, perfil } = {}, ctx) {
      if (!/^\w[\w.-]{0,99}$/.test(String(composicao ?? '')) || String(composicao).includes('..')) throw new Error('Informe o nome da composição (pasta em HyperFrames/composicoes).');
      const q = QUALIDADES.includes(qualidade) ? qualidade : 'looks';
      tarefaNaNuvem(ctx, 'renderizar', perfil, [composicao, q], { titulo: `Renderizar "${composicao}" (${q})`, alvo: composicao });
      return { mensagem: `Render de "${composicao}" no Colab iniciado.` };
    },

    // Login do CLI pela aba: o link aparece num botão e o código é colado num campo (ver enviarCodigo).
    async login(_, ctx) {
      const aberto = ctx.processos.ativos().find((p) => p.tipo === 'login');
      if (aberto) return { mensagem: 'O login já está aberto na aba Colab.' };
      wsl(ctx, 'rodar.sh', ['login'], { tipo: 'login', titulo: 'Login do Colab CLI' });
      return { mensagem: 'Gerando o link de login…' };
    },

    async enviarCodigo({ id, codigo } = {}, ctx) {
      const p = ctx.processos.obter(id);
      if (p?.tipo !== 'login' || p.estado !== 'rodando') throw new Error('O login não está esperando um código. Clique em "fazer login" de novo.');
      const c = String(codigo || '').trim();
      // O código do Google é uma linha só (ex.: 4/0Ab…); nada de quebra de linha nem espaço.
      if (!/^[\w\/.~+-]{10,512}$/.test(c)) throw new Error('Cole o código inteiro que o Google mostrou, sem espaços.');
      if (!ctx.processos.enviar(id, `${c}\n`)) throw new Error('O login já terminou. Clique em "fazer login" de novo.');
      return { mensagem: 'Conferindo o código…' };
    },

    // "Já autorizei": manda o Enter que o `colab drivemount` está esperando.
    async continuarDrive({ id } = {}, ctx) {
      const p = ctx.processos.obter(id);
      if (!p?.dados?.autorizarDrive) throw new Error('Este processo não está esperando a autorização do Drive.');
      if (!ctx.processos.enviar(id, '\n')) throw new Error('O processo já terminou.');
      return { mensagem: 'Continuando a montagem do Drive…' };
    },

    // Narração com o Chatterbox (notebooks/3_voz). Não usa o Drive: o texto vai em base64, a voz de
    // referência é enviada para a VM e o .wav volta direto (colab download), copiado para HyperFrames/voz.
    async voz({ texto, nome, referencia, expressao, ritmo, perfil } = {}, ctx) {
      const t = String(texto || '').trim();
      if (!t) throw new Error('Escreva o texto da narração.');
      // Limite da linha de comando do Windows (o texto passa em base64 pelo wsl.exe): ~12 mil caracteres ≈ 15 min de fala.
      if (t.length > 12000) throw new Error(`Texto longo demais (${t.length} caracteres; máximo 12000). Divida em partes.`);
      const n = ctx.util.slug(nome) || `narracao-${ctx.util.carimbo()}`;
      let ref = '';
      if (referencia) {
        const origem = path.join(ctx.pastas.referencia, path.basename(referencia));
        if (!existsSync(origem)) throw new Error('Voz de referência não encontrada.');
        // Cópia com nome simples numa pasta que o WSL enxerga (o G: do Drive nem sempre aparece lá).
        ref = `${ctx.util.slug(path.parse(origem).name) || 'ref'}${path.extname(origem).toLowerCase()}`;
        await mkdir(path.join(ctx.config.cli, '_voz', 'ref'), { recursive: true });
        await copyFile(origem, path.join(ctx.config.cli, '_voz', 'ref', ref));
      }
      const num = (v, min, max) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? '' : String(Math.min(max, Math.max(min, Number(v)))));
      const local = path.join(ctx.config.cli, '_voz', `${n}.wav`);
      tarefaNaNuvem(ctx, 'voz', perfil, [n, Buffer.from(t, 'utf8').toString('base64'), ref, num(expressao, 0.25, 1.5), num(ritmo, 0, 1)], {
        titulo: `Narração "${n}"`, alvo: n,
        aoTerminar: async (p) => {
          if (p.estado !== 'concluido' || !existsSync(local)) return;
          try {
            await mkdir(ctx.pastas.voz, { recursive: true });
            const destino = path.join(ctx.pastas.voz, `${n}.wav`);
            await copyFile(local, destino);
            p.dados = { ...p.dados, arquivo: destino };
            ctx.publicar('plugin', {});
          } catch (e) {
            p.estado = 'erro';
            p.erro = `A voz foi gerada, mas não consegui copiar para HyperFrames/voz: ${e.message}`;
          }
        },
      });
      return { mensagem: `Gerando "${n}"…` };
    },

    // Renderiza um script de Blender/scripts no Cycles da GPU do Colab (notebooks/4_blender). O script sobe
    // para a VM, o Blender oficial é instalado lá (SHA-256 conferido) e o .zip com png/glb/blend volta para
    // Blender/saida/<nome>.
    async blender({ script, nome, porcentagem, amostras, perfil } = {}, ctx) {
      const base = path.basename(String(script || ''));
      const arq = base.toLowerCase().endsWith('.py') ? base : `${base}.py`;
      const caminho = path.join(ctx.config.blender, 'scripts', arq);
      if (!/^[a-z0-9][\w-]*\.py$/i.test(arq) || !existsSync(caminho)) throw new Error('Script não encontrado em Blender/scripts.');
      const n = ctx.util.slug(nome || path.parse(arq).name) || 'modelo';
      const pct = Math.min(400, Math.max(10, Math.round(Number(porcentagem) || 100)));
      const amo = Math.min(8192, Math.max(1, Math.round(Number(amostras) || 256)));
      const zip = path.join(ctx.config.cli, '_blender', `${n}.zip`);
      tarefaNaNuvem(ctx, 'blender', perfil, [n, noWsl(caminho), String(pct), String(amo)], {
        titulo: `3D "${n}" (${pct}% · ${amo} amostras)`, alvo: n,
        aoTerminar: async (p) => {
          if (p.estado !== 'concluido' || !existsSync(zip)) return;
          const destino = path.join(ctx.config.blender, 'saida', `${n}-colab`);
          try {
            await mkdir(destino, { recursive: true });
            await extrairZip(zip, destino);
            p.dados = { ...p.dados, pasta: destino };
            ctx.publicar('plugin', { plugin: 'blender' });
          } catch (e) {
            p.estado = 'erro';
            p.erro = `O render terminou, mas não consegui abrir o .zip: ${e.message}`;
          }
        },
      });
      return { mensagem: `Mandando "${n}" para o Blender no Colab…` };
    },

    // Imagem (Blender/entrada) → modelo 3D com textura pelo TRELLIS.2 e vitrine no Blender, tudo no Colab.
    // Resultado em Blender/saida/<nome>-ia. As extensões compiladas na primeira vez voltam junto e ficam em
    // colab-cli/_rodas, para as próximas rodadas não compilarem de novo.
    async ia3d({ imagem, nome, qualidade, textura, faces, amostras, giro, semente, perfil } = {}, ctx) {
      const entrada = path.join(ctx.config.blender, 'entrada');
      const arq = path.basename(String(imagem || ''));
      const caminho = path.join(entrada, arq);
      if (!/\.(png|jpe?g|webp)$/i.test(arq) || !existsSync(caminho)) throw new Error('Imagem não encontrada em Blender/entrada.');
      if (!existsSync(arqTokenHF(ctx))) throw new Error('Falta o token do Hugging Face (3D por IA → token).');
      const n = ctx.util.slug(nome || path.parse(arq).name) || 'modelo';
      const q = ['512', '1024_cascade', '1536_cascade'].includes(qualidade) ? qualidade : '1024_cascade';
      const tex = [1024, 2048, 4096].includes(Number(textura)) ? Number(textura) : 2048;
      const fc = Math.min(2000000, Math.max(50000, Math.round(Number(faces) || 500000)));
      const amo = Math.min(4096, Math.max(16, Math.round(Number(amostras) || 256)));
      const gi = Math.min(240, Math.max(0, Math.round(Number(giro) || 0)));
      const se = Math.max(0, Math.round(Number(semente) || 42));
      const zip = path.join(ctx.config.cli, '_ia3d', `${n}.zip`);
      tarefaNaNuvem(ctx, 'ia3d', perfil, [n, noWsl(caminho), q, String(tex), String(fc), String(amo), String(gi), String(se)], {
        titulo: `3D por IA "${n}" (${q} · textura ${tex} · ${Math.round(fc / 1000)} mil faces${gi ? ` · giro ${gi}` : ''})`, alvo: n,
        aoTerminar: async (p) => {
          if (p.estado !== 'concluido' || !existsSync(zip)) return;
          const destino = path.join(ctx.config.blender, 'saida', `${n}-ia`);
          try {
            await mkdir(destino, { recursive: true });
            await extrairZip(zip, destino);
            const rodas = path.join(destino, '_rodas', 'trellis2-rodas.tar');
            if (existsSync(rodas)) {
              await mkdir(path.join(ctx.config.cli, '_rodas'), { recursive: true });
              await rename(rodas, path.join(ctx.config.cli, '_rodas', 'trellis2-rodas.tar'));
            }
            await rm(path.join(destino, '_rodas'), { recursive: true, force: true });
            p.dados = { ...p.dados, pasta: destino };
            ctx.publicar('plugin', { plugin: 'blender' });
          } catch (e) {
            p.estado = 'erro';
            p.erro = `O 3D ficou pronto, mas não consegui abrir o .zip: ${e.message}`;
          }
        },
      });
      return { mensagem: `Mandando "${arq}" para o TRELLIS.2 no Colab…` };
    },

    // Token do Hugging Face: fica em colab-cli/_segredos (fora do git), sobe para a VM como arquivo e é
    // apagado de lá logo depois de lido. Nunca volta para a interface.
    async salvarTokenHF({ token } = {}, ctx) {
      const t = String(token || '').trim();
      if (!/^hf_[A-Za-z0-9]{20,}$/.test(t)) throw new Error('Isso não parece um token do Hugging Face (começa com hf_).');
      await mkdir(path.dirname(arqTokenHF(ctx)), { recursive: true });
      await writeFile(arqTokenHF(ctx), t, { mode: 0o600 });
      mem.hf = { conferidoEm: null };
      return { mensagem: 'Token salvo. Clique em conferir acesso.' };
    },
    async apagarTokenHF(_, ctx) {
      await rm(arqTokenHF(ctx), { force: true });
      mem.hf = { conferidoEm: null };
      return { mensagem: 'Token apagado.' };
    },
    async statusHF(_, ctx) {
      return { token: existsSync(arqTokenHF(ctx)), ...mem.hf };
    },
    // Confere no próprio Hugging Face se o token vale e se o acesso ao DINOv3 já foi aprovado.
    async conferirHF(_, ctx) {
      if (!existsSync(arqTokenHF(ctx))) throw new Error('Nenhum token salvo.');
      const cab = { Authorization: `Bearer ${(await readFile(arqTokenHF(ctx), 'utf8')).trim()}` };
      const quem = await fetch('https://huggingface.co/api/whoami-v2', { headers: cab, signal: AbortSignal.timeout(15000) });
      if (!quem.ok) {
        mem.hf = { conferidoEm: Date.now(), usuario: null, dinov3: 'token inválido' };
        return { token: true, ...mem.hf };
      }
      const usuario = (await quem.json()).name || null;
      const dino = await fetch('https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m/resolve/main/config.json',
        { method: 'HEAD', headers: cab, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const liberado = dino.status === 200 || (dino.status >= 300 && dino.status < 400);
      mem.hf = { conferidoEm: Date.now(), usuario, dinov3: liberado ? 'liberado' : 'pendente' };
      return { token: true, ...mem.hf };
    },

    // ----- perfis de máquina -----
    async usarPerfil({ id } = {}) {
      if (!perfilDe(id)) throw new Error('Perfil não encontrado.');
      mem.ativo = id;
      return { mensagem: `Usando o perfil "${perfilDe(id).nome}".` };
    },

    async salvarPerfil({ id, nome, tarefas, padrao } = {}, ctx) {
      const perfil = normalizarPerfil({ nome, tarefas });
      let chave = perfilDe(id) ? id : ctx.util.slug(perfil.nome).slice(0, 34) || `perfil-${Date.now()}`;
      if (!perfilDe(id)) while (Object.hasOwn(mem.perfis.perfis, chave)) chave = `${chave}-2`;
      mem.perfis.perfis[chave] = perfil;
      if (padrao) mem.perfis.padrao = chave;
      mem.ativo = chave;
      await gravarJson(ARQ_PERFIS, mem.perfis);
      return { mensagem: `Perfil "${perfil.nome}" salvo.`, id: chave };
    },

    async apagarPerfil({ id } = {}) {
      if (!perfilDe(id)) throw new Error('Perfil não encontrado.');
      if (Object.keys(mem.perfis.perfis).length === 1) throw new Error('Precisa sobrar pelo menos um perfil.');
      delete mem.perfis.perfis[id];
      const primeiro = Object.keys(mem.perfis.perfis)[0];
      if (mem.perfis.padrao === id) mem.perfis.padrao = primeiro;
      if (mem.ativo === id) mem.ativo = mem.perfis.padrao;
      await gravarJson(ARQ_PERFIS, mem.perfis);
      return { mensagem: 'Perfil apagado.' };
    },

    async definirPadrao({ id } = {}) {
      if (!perfilDe(id)) throw new Error('Perfil não encontrado.');
      mem.perfis.padrao = id;
      await gravarJson(ARQ_PERFIS, mem.perfis);
      return { mensagem: `"${perfilDe(id).nome}" abre como padrão.` };
    },

    // ----- máquinas ligadas -----
    async desligarSessao({ sessao } = {}, ctx) {
      if (!/^editorvideos-[a-z0-9-]+$/.test(sessao || '')) throw new Error('Sessão inválida.');
      if (ctx.processos.ativos().some((p) => p.dados?.sessao === sessao)) throw new Error('Essa máquina está rodando uma tarefa: cancele a tarefa.');
      desligarSessao(ctx, sessao, 'pedido na aba');
      return { mensagem: `Desligando ${sessao}…` };
    },

    async conferirSessoes(_, ctx) {
      await conferirSessoes(ctx);
      return { mensagem: mem.ligadas.length ? `${mem.ligadas.length} máquina(s) ligada(s).` : 'Nenhuma máquina do Painel ligada.' };
    },

    // Desliga todas as sessões do Painel no Colab (inclusive sobras de um cancelamento).
    async desligar(_, ctx) {
      for (const s of [...mem.mantidas.keys()]) soltar(ctx, s);
      wsl(ctx, 'rodar.sh', ['parar'], { tipo: 'desligar', titulo: 'Desligar todas as VMs do Painel', aoTerminar: () => conferirSessoes(ctx) });
      return { mensagem: 'Desligando as VMs do Colab…' };
    },
  },
};
