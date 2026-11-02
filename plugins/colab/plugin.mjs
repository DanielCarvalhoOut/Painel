// Serviço Colab: acompanha os notebooks que rodam no Google Colab. Não há conexão direta — cada
// notebook grava um JSON de status em _colab/status no Drive, e o Drive para desktop traz para cá.
// Formato do status: ver notebooks/LEIAME.md (servico, estado, etapa, progresso, log, gpu, ram…).

//
// Com o Colab CLI oficial (pasta colab-cli, roda pelo WSL) o Painel também liga a VM, executa o notebook
// e desliga sozinho, sem abrir o navegador. O andamento continua chegando pelo mesmo JSON de status.

import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAINEL = path.resolve(fileURLToPath(import.meta.url), '../../..');
const QUALIDADES = ['draft', 'looks', 'delivery'];

// D:\EditorVideosFoto\x → /mnt/d/EditorVideosFoto/x (caminho visto de dentro do WSL).
const noWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
const cliInstalado = (ctx) => existsSync(path.join(ctx.config.cli, 'bin', 'colab'));

// Na primeira montagem do Drive o CLI escreve "REQUIRED: Google Drive Authorization needed", o link numa
// linha própria e espera um Enter. Guardamos o link em p.dados para a aba mostrar os botões.
function lerAutorizacao(linha, p) {
  if (/Google Drive Authorization needed/i.test(linha)) p.dados = { ...p.dados, autorizarDrive: true };
  else if (p.dados?.autorizarDrive === true && /^https:\/\/\S+$/.test(linha)) p.dados = { ...p.dados, autorizarDrive: linha };
  else if (/\[colab\] Authorizing VM/i.test(linha) && p.dados?.autorizarDrive) p.dados = { ...p.dados, autorizarDrive: null };
  // Login: o CLI mostra o link do Google (linha própria, com recuo) e espera o código na entrada.
  else if (p.tipo === 'login' && /^\s*https:\/\/accounts\.google\.com\/\S+$/.test(linha)) p.dados = { ...p.dados, loginUrl: linha.trim() };
}

// Roda colab-cli/<script> no WSL; o processo aparece na aba com o log do CLI.
function wsl(ctx, script, args, extra) {
  if (!cliInstalado(ctx)) throw new Error('Colab CLI não instalado: rode colab-cli/instalar.sh no WSL (ver README).');
  return ctx.processos.iniciar({
    comando: 'wsl.exe', args: ['-d', ctx.config.distro, '--', 'bash', noWsl(path.join(ctx.config.cli, script)), ...args],
    lerLinha: lerAutorizacao,
    ...extra,
  });
}

// Etapa de um processo do CLI lida do próprio log, para o ícone flutuante e o cartão. O JSON de status
// só aparece depois que o notebook começa (e o Drive ainda leva um tempo para trazê-lo ao PC).
const TITULOS_CLI = { transcrever: 'transcrever na T4', renderizar: 'render no Colab', voz: 'narração na T4', login: 'login', desligar: 'desligando VMs' };
function etapaCli(p) {
  if (p.dados?.autorizarDrive) return { detalhe: 'esperando você autorizar o Drive', atencao: true };
  if (p.tipo === 'login') return { detalhe: p.dados?.loginUrl ? 'esperando o código de login' : 'gerando o link', atencao: !!p.dados?.loginUrl };
  for (let i = p.log.length - 1; i >= 0; i--) {
    const l = p.log[i];
    const celula = l.match(/Executing cell (\d+)\/(\d+) - (.*?)\.*$/);
    if (celula) return { detalhe: `célula ${celula[1]}/${celula[2]} · ${celula[3].replace(/^\d+\.\s*/, '')}`, progresso: Math.round(((celula[1] - 1) / celula[2]) * 100) };
    if (/Saving notebook|\[rodar\] concluído/.test(l)) return { detalhe: 'terminando e desligando a VM', progresso: 100 };
    if (/Mounting Google Drive|Authorizing VM|Credentials propagated/.test(l)) return { detalhe: 'montando o Google Drive' };
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

export default {
  id: 'colab',
  nome: 'Colab',
  logo: 'logo.svg',
  icone: '[☁︎]',
  descricao: 'Transcrição (Whisper) e render pesados na GPU/CPU do Google Colab.',
  tipo: 'servico',
  ordem: 20,
  papel: 'Força na nuvem',
  perfil: {
    forte: 'O trabalho pesado que o PC não aguenta, numa GPU do Google, ligada e desligada sozinha.',
    usos: ['transcrição de qualidade (Whisper large na T4)', 'render longo ou em qualidade final', 'qualquer notebook que precise de GPU'],
    naoE: 'criar ou editar; é o motor, não o estúdio',
  },
  flutuante: true,  // pode mostrar o andamento num ícone flutuante nas outras abas
  usar: [{
    rotulo: 'transcrever na GPU', acao: 'transcrever', descricao: 'Whisper na T4 do Colab; o texto vira as legendas.',
    aviso: 'O Colab só vê o vídeo depois que o Drive termina de subir (ícone do Google Drive na bandeja). Vídeo grande: espere a sincronização.',
  }],
  padroes: (g) => ({
    drive: path.join(g.drive, '_colab'), vozes: path.join(g.drive, 'HyperFrames', 'voz'),
    semSinalAposSegundos: 120, cli: path.join(PAINEL, 'colab-cli'), distro: 'Ubuntu',
  }),
  pastas: (cfg) => ({
    status: path.join(cfg.drive, 'status'), notebooks: path.join(cfg.drive, 'notebooks'),
    // Narrações geradas (3_voz) e gravações de referência para a voz própria.
    voz: cfg.vozes, referencia: path.join(cfg.vozes, 'referencia'),
  }),

  async iniciar(ctx) {
    if (!existsSync(path.parse(ctx.config.drive).root)) return;
    await Promise.all(Object.values(ctx.pastas).map((d) => mkdir(d, { recursive: true }).catch(() => {})));
  },

  async estado(ctx) {
    const drive = existsSync(path.parse(ctx.config.drive).root);
    const [lista, notebooks, vozes, referencias] = await Promise.all([
      servicos(ctx),
      ctx.arquivos.listar(ctx.pastas.notebooks).then((l) => l.filter((a) => a.nome.endsWith('.ipynb'))),
      ctx.arquivos.listar(ctx.pastas.voz, ['audio']),
      ctx.arquivos.listar(ctx.pastas.referencia, ['audio']),
    ]);
    const rodando = lista.filter((s) => s.estado === 'rodando');
    const semSinal = lista.filter((s) => s.estado === 'sem-sinal');
    const gpu = rodando.find((s) => s.gpu?.nome)?.gpu;
    const cli = ctx.processos.ativos();
    return {
      status: !drive ? 'erro' : semSinal.length ? 'aviso' : rodando.length || cli.length ? 'ok' : 'off',
      rotulo: !drive ? 'sem Drive' : rodando.length || cli.length ? `rodando ${rodando.length || cli.length}` : semSinal.length ? 'sem sinal' : 'ocioso',
      resumo: !drive ? 'O Google Drive (G:) não está montado; o Painel não vê o Colab.' : null,
      metricas: [
        ['Serviços', String(lista.length)],
        ['Rodando', String(rodando.length)],
        ['GPU', gpu ? gpu.nome : '—'],
        ['Notebooks', String(notebooks.length)],
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
    };
  },

  acoes: {
    // Liga uma T4, transcreve o que estiver novo em HyperFrames/entrada (ou só `arquivo`) e desliga.
    async transcrever({ arquivo } = {}, ctx) {
      if (ctx.processos.ativos().some((p) => p.tipo === 'transcrever')) throw new Error('Já há uma transcrição rodando.');
      wsl(ctx, 'rodar.sh', ['transcrever', ...(arquivo ? [String(arquivo)] : [])], {
        tipo: 'transcrever', titulo: 'Transcrever na GPU T4 (Colab CLI)', alvo: arquivo || 'entrada',
      });
      return { mensagem: 'Ligando uma GPU T4 no Colab…' };
    },

    // Renderiza uma composição numa VM de CPU com RAM alta e desliga.
    async renderizar({ composicao, qualidade } = {}, ctx) {
      if (!/^[\w.-]+$/.test(composicao || '')) throw new Error('Informe o nome da composição (pasta em HyperFrames/composicoes).');
      const q = QUALIDADES.includes(qualidade) ? qualidade : 'looks';
      wsl(ctx, 'rodar.sh', ['renderizar', composicao, q], {
        tipo: 'renderizar', titulo: `Renderizar "${composicao}" no Colab (${q})`, alvo: composicao,
      });
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

    // Narração com o Chatterbox numa T4 (notebooks/3_voz). O texto vai em base64; o .wav volta direto da VM
    // (colab download) e é copiado para HyperFrames/voz, sem esperar o Drive sincronizar.
    async voz({ texto, nome, referencia, expressao, ritmo } = {}, ctx) {
      if (ctx.processos.ativos().some((p) => p.tipo === 'voz')) throw new Error('Já há uma narração sendo gerada.');
      const t = String(texto || '').trim();
      if (!t) throw new Error('Escreva o texto da narração.');
      // Limite da linha de comando do Windows (o texto passa em base64 pelo wsl.exe): ~12 mil caracteres ≈ 15 min de fala.
      if (t.length > 12000) throw new Error(`Texto longo demais (${t.length} caracteres; máximo 12000). Divida em partes.`);
      const n = ctx.util.slug(nome) || `narracao-${ctx.util.carimbo()}`;
      if (referencia && !existsSync(path.join(ctx.pastas.referencia, path.basename(referencia)))) throw new Error('Voz de referência não encontrada.');
      const num = (v, min, max) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? '' : String(Math.min(max, Math.max(min, Number(v)))));
      const local = path.join(ctx.config.cli, '_voz', `${n}.wav`);
      wsl(ctx, 'rodar.sh', ['voz', n, Buffer.from(t, 'utf8').toString('base64'), referencia ? path.basename(referencia) : '', num(expressao, 0.25, 1.5), num(ritmo, 0, 1)], {
        tipo: 'voz', titulo: `Narração "${n}" (Chatterbox na T4)`, alvo: n,
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
      return { mensagem: `Gerando "${n}": a T4 liga, instala o Chatterbox (uns 5 min) e narra.` };
    },

    // Cancelar o processo daqui não garante que a VM caiu: isto desliga as sessões do Painel no Colab.
    async desligar(_, ctx) {
      wsl(ctx, 'rodar.sh', ['parar'], { tipo: 'desligar', titulo: 'Desligar VMs do Colab' });
      return { mensagem: 'Desligando as VMs do Colab…' };
    },
  },
};
