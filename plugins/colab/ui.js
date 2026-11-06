// Aba do Colab: um painel por serviço (etapa, progresso, GPU, RAM, log) e os notebooks no Drive.
import { esc, attr, barra, simbolo, atras, desenhar, lista, linhaArquivo, linhaProcesso, botoesPastas, tamanho } from '/core/ui.js';

let el;
let ctxUi;

const mb = (v) => (v == null ? '—' : tamanho(v * 1024 * 1024));
const uso = (usado, total) => (usado != null && total ? barra((usado / total) * 100, 12) : '<span class="barra"><span class="vazia">—</span></span>');

function servico(s) {
  return `<article class="bloco" style="padding:16px 18px;display:grid;gap:12px" data-chave="s-${esc(s.servico)}">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
      <div><span class="st ${s.estado === 'concluido' ? 'ok' : s.estado === 'rodando' ? 'aviso' : 'erro'}">${simbolo(s.estado)}</span>
        <b style="margin-left:8px;font-weight:600">${esc(s.servico)}</b>
        <span class="mono" style="font-size:12px;color:var(--faint);margin-left:8px">${esc(s.notebook || '')}</span></div>
      <span class="mono" style="font-size:12px;color:var(--muted)">${esc(s.estado)} · sinal ${atras(s.atualizado)}</span>
    </div>
    <div class="mono" style="font-size:13px">${esc(s.etapa || '')}${s.mensagem ? ` <span style="color:var(--muted)">— ${esc(s.mensagem)}</span>` : ''}</div>
    <div>${barra(s.progresso ?? null, 32)}</div>
    <dl class="mono" style="margin:0;display:grid;grid-template-columns:auto auto 1fr;gap:4px 14px;font-size:12px">
      <dt style="color:var(--faint)">GPU</dt><dd style="margin:0">${esc(s.gpu?.nome || '—')}</dd><dd style="margin:0">${uso(s.gpu?.memoria_usada_mb, s.gpu?.memoria_total_mb)} ${s.gpu ? `${mb(s.gpu.memoria_usada_mb)} / ${mb(s.gpu.memoria_total_mb)}` : ''}</dd>
      <dt style="color:var(--faint)">RAM</dt><dd style="margin:0"></dd><dd style="margin:0">${uso(s.ram?.usada_mb, s.ram?.total_mb)} ${s.ram ? `${mb(s.ram.usada_mb)} / ${mb(s.ram.total_mb)}` : ''}</dd>
    </dl>
    ${s.log?.length ? `<details><summary class="mono" style="font-size:11px;color:var(--faint);cursor:pointer">log (${s.log.length})</summary><pre class="mono" style="margin:6px 0 0;max-height:200px;overflow:auto;background:var(--bg);border:1px solid var(--line-soft);border-radius:3px;padding:8px;font-size:11px;color:var(--muted);white-space:pre-wrap">${esc(s.log.join('\n'))}</pre></details>` : ''}
    ${s.estado === 'sem-sinal' ? '<p class="dica" style="margin:0">Sem sinal há mais de 2 min. Confira a aba do Colab: a sessão pode ter caído ou pedido confirmação.</p>' : ''}
  </article>`;
}

// Primeira montagem do Drive: o CLI mostra um link do Google e espera. Aprovar lá e voltar aqui.
function autorizacao(p) {
  const link = p.dados?.autorizarDrive;
  if (p.estado !== 'rodando' || !link) return '';
  return `<div class="bloco" style="padding:12px 14px;display:grid;gap:10px;border-color:var(--amber)" data-chave="a${p.id}">
    <div class="mono" style="font-size:13px"><span class="st aviso">[!]</span> O Google pede para autorizar o Colab a montar o seu Drive (só na primeira vez).</div>
    <div class="acoes">
      ${typeof link === 'string' ? `<button class="acao forte" data-abrir="${esc(link)}">[↗] autorizar Drive</button>` : '<span class="mono" style="font-size:12px;color:var(--muted)">esperando o link…</span>'}
      <button class="acao forte" data-acao="continuarDrive" data-params="${attr({ id: p.id })}">[>] já autorizei</button>
    </div>
    <p class="dica" style="margin:0">Use a mesma conta do Colab Pro. Depois de aprovar no Google, clique em "já autorizei" e a tarefa continua sozinha.</p>
  </div>`;
}

// Login do CLI sem terminal. Fica num bloco próprio, sem o tempo do processo, para não redesenhar
// (e apagar o código colado) a cada evento.
function blocoLogin(processos) {
  const ultimo = processos.find((p) => p.tipo !== 'desligar');
  if (!ultimo) return '';
  const caixa = (conteudo) => `<div class="bloco" style="padding:12px 14px;display:grid;gap:10px;border-color:var(--amber)">${conteudo}</div>`;
  if (ultimo.tipo === 'login' && ultimo.estado === 'rodando') {
    const url = ultimo.dados?.loginUrl;
    if (!url) return caixa('<div class="mono" style="font-size:13px">Gerando o link de login…</div>');
    return caixa(`
      <div class="mono" style="font-size:13px"><span class="st aviso">[1]</span> Entre com a conta do Colab Pro (a mesma do Drive deste PC) e aceite.</div>
      <div class="acoes"><button class="acao forte" data-abrir="${esc(url)}">[↗] abrir login do Google</button></div>
      <div class="mono" style="font-size:13px"><span class="st aviso">[2]</span> O Google mostra um código. Cole aqui:</div>
      <form class="acoes" id="clCodigoForm" data-id="${ultimo.id}" style="align-items:end">
        <label class="campo" style="flex:1;min-width:220px"><span>código</span><input id="clCodigo" autocomplete="off" spellcheck="false" placeholder="4/0A…" style="width:100%"></label>
        <button class="acao forte" type="submit">[>] enviar código</button>
      </form>`);
  }
  if (ultimo.tipo === 'login' && ultimo.estado === 'concluido') {
    return caixa('<div class="mono" style="font-size:13px"><span class="st ok">[ok]</span> Login feito. Agora é só usar os botões acima.</div>');
  }
  if (ultimo.estado === 'erro' && /Falta o login|invalid_grant|Failed to refresh token|Token has been expired/i.test(`${ultimo.erro} ${(ultimo.log || []).join(' ')}`)) {
    const repetir = ultimo.tipo === 'login';
    return caixa(`
      <div class="mono" style="font-size:13px"><span class="st erro">[!]</span> ${repetir ? 'O login não deu certo (código errado ou expirado).' : 'O Colab CLI ainda não está conectado à sua conta Google.'}</div>
      <div class="acoes"><button class="acao forte" data-acao="login">[>] ${repetir ? 'tentar de novo' : 'fazer login agora'}</button></div>
      <p class="dica" style="margin:0">É uma vez só. Depois, ${repetir ? 'os botões acima funcionam sem pedir nada' : 'clique de novo no que você tentou rodar'}.</p>`);
  }
  return '';
}

// ---------- máquinas e perfis ----------
const minutos = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Tabela (só leitura) do perfil ativo: que máquina cada tarefa usa.
function tabelaPerfil(m) {
  const p = m.perfis[m.ativo];
  if (!p) return '';
  const linhas = Object.entries(m.tarefas).map(([id, t]) => {
    const c = p.tarefas[id];
    const maq = m.catalogo[c.maquina];
    return `<tr><td>${esc(t.rotulo)}</td><td><b>${esc(maq?.nome || c.maquina)}</b></td><td>${c.ramAlta ? 'sim' : '—'}</td>
      <td>${c.manterMin ? `${c.manterMin} min` : 'desliga já'}</td><td>${c.limiteMin} min</td></tr>`;
  }).join('');
  return `<table class="tab-maq"><thead><tr><th>tarefa</th><th>máquina</th><th>RAM alta</th><th>depois</th><th>limite</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

// Máquinas do Painel ligadas agora (mantidas para a próxima tarefa, em uso ou sobras).
function ligadas(m) {
  if (!m.ligadas.length) return `<p class="vazio" style="padding:6px 0">Nenhuma máquina do Painel ligada${m.conferidoEm ? ` · conferido ${atras(m.conferidoEm)}` : ''}.</p>`;
  return m.ligadas.map((l) => `<div class="maq-ligada ${l.sobra ? 'sobra' : ''}">
      <span class="st ${l.sobra ? 'erro' : l.emUso ? 'aviso' : 'ok'}">${l.sobra ? '[!]' : l.emUso ? '[~]' : '[●]'}</span>
      <span class="mono"><b>${esc(l.sessao)}</b> · ${esc(l.hardware)}</span>
      <span class="mono maq-quando">${l.emUso ? 'rodando uma tarefa' : l.desligarEm ? `desliga em ${minutos(l.desligarEm - Date.now())}` : 'ligada sem tarefa: gastando à toa'}</span>
      ${l.emUso ? '' : `<button class="acao ${l.sobra ? 'forte' : ''}" data-acao="desligarSessao" data-params="${attr({ sessao: l.sessao })}">[■] desligar agora</button>`}
    </div>`).join('');
}

function historico(m) {
  if (!m.historico.length) return '';
  return `<details><summary class="mono" style="font-size:11px;color:var(--faint);cursor:pointer">gasto das últimas tarefas</summary>
    <div class="lista" style="margin-top:6px">${m.historico.map((h) => `<div class="mono hist">
      <span class="st ${h.estado === 'concluido' ? 'ok' : 'erro'}">${simbolo(h.estado)}</span>
      <span>${esc(h.titulo)}</span><span>${h.fim && h.inicio ? minutos(h.fim - h.inicio) : '—'}</span>
      <span><b>${h.gasto != null ? `${h.gasto.toFixed(2)} un.` : '—'}</b></span><span style="color:var(--faint)">${atras(h.fim || h.inicio)}</span></div>`).join('')}</div>
    <p class="dica" style="margin:6px 0 0">Gasto = saldo antes − saldo depois, lido com <span class="mono">colab usage</span>. O Google atualiza o saldo com atraso: tarefas curtas podem aparecer como 0.</p></details>`;
}

// Editor de um perfil. Desenhado uma vez ao abrir (não é redesenhado a cada evento, para não perder o que se digita).
function editorPerfil(m, id) {
  const p = id ? m.perfis[id] : { nome: '', tarefas: m.perfis[m.ativo].tarefas };
  const linha = ([tid, t]) => {
    const c = p.tarefas[tid];
    const opcoes = t.maquinas.map((q) => `<option value="${q}" ${q === c.maquina ? 'selected' : ''}>${esc(m.catalogo[q].nome)}</option>`).join('');
    return `<fieldset class="ed-tarefa" data-tarefa="${tid}">
      <legend>${esc(t.rotulo)}</legend>
      <label class="campo"><span>máquina</span><select data-c="maquina">${opcoes}</select></label>
      <label class="campo ed-check"><span>RAM alta</span><input type="checkbox" data-c="ramAlta" ${c.ramAlta ? 'checked' : ''}></label>
      <label class="campo"><span>manter ligada (min)</span><input type="number" data-c="manterMin" min="0" max="120" step="5" value="${c.manterMin}" style="width:80px"></label>
      <label class="campo"><span>limite (min)</span><input type="number" data-c="limiteMin" min="5" max="720" step="5" value="${c.limiteMin}" style="width:80px"></label>
      <p class="ed-explica mono"></p>
    </fieldset>`;
  };
  return `<form id="clPerfilForm" class="ed-perfil" data-id="${esc(id || '')}">
    <div class="acoes" style="align-items:end">
      <label class="campo"><span>nome do perfil</span><input id="clPerfilNome" maxlength="40" required value="${esc(p.nome)}" placeholder="ex.: 3D pesado"></label>
      <label class="campo ed-check"><span>abrir como padrão</span><input type="checkbox" id="clPerfilPadrao" ${id && id === m.padrao ? 'checked' : ''}></label>
    </div>
    ${Object.entries(m.tarefas).map(linha).join('')}
    <div class="ed-ajuda">${Object.entries({ 'máquina': m.opcoes.maquina, 'RAM alta': m.opcoes.ramAlta, 'manter ligada': m.opcoes.manterMin, 'limite': m.opcoes.limiteMin })
      .map(([k, v]) => `<p class="mono"><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}</div>
    <div class="acoes"><button class="acao forte" type="submit">[✓] salvar perfil</button><button class="acao" type="button" data-fechar>cancelar</button></div>
  </form>`;
}

// Explicação da máquina escolhida e RAM alta só onde existe; atualiza ao trocar.
function ajustarLinha(fs, m) {
  const q = fs.querySelector('[data-c=maquina]').value;
  const ram = fs.querySelector('[data-c=ramAlta]');
  ram.disabled = !m.catalogo[q].ramAlta;
  if (ram.disabled) ram.checked = false;
  fs.querySelector('.ed-explica').textContent = m.catalogo[q].explica;
}

function blocoMaquinas(raiz) {
  raiz.querySelector('#clPerfil').addEventListener('change', (ev) => ctxUi.acao('usarPerfil', { id: ev.target.value }).catch(() => {}));
  const abrirEditor = (id) => {
    const m = ctxUi.estado()?.maquinas;
    if (!m) return;
    const caixa = raiz.querySelector('#clEditor');
    caixa.innerHTML = editorPerfil(m, id);
    for (const fs of caixa.querySelectorAll('.ed-tarefa')) ajustarLinha(fs, m);
    caixa.querySelector('#clPerfilNome').focus();
  };
  raiz.querySelector('#clPerfilEditar').addEventListener('click', () => abrirEditor(raiz.querySelector('#clPerfil').value));
  raiz.querySelector('#clPerfilNovo').addEventListener('click', () => abrirEditor(null));
  raiz.querySelector('#clPerfilPadrao2').addEventListener('click', () => ctxUi.acao('definirPadrao', { id: raiz.querySelector('#clPerfil').value }).catch(() => {}));
  raiz.querySelector('#clPerfilApagar').addEventListener('click', () => {
    const sel = raiz.querySelector('#clPerfil');
    if (confirm(`Apagar o perfil "${sel.selectedOptions[0]?.textContent}"?`)) ctxUi.acao('apagarPerfil', { id: sel.value }).catch(() => {});
  });
  const editor = raiz.querySelector('#clEditor');
  editor.addEventListener('change', (ev) => {
    const fs = ev.target.closest('.ed-tarefa');
    if (fs && ev.target.dataset.c === 'maquina') ajustarLinha(fs, ctxUi.estado().maquinas);
  });
  editor.addEventListener('click', (ev) => { if (ev.target.closest('[data-fechar]')) editor.innerHTML = ''; });
  editor.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const tarefas = {};
    for (const fs of form.querySelectorAll('.ed-tarefa')) {
      const v = (c) => fs.querySelector(`[data-c=${c}]`);
      tarefas[fs.dataset.tarefa] = { maquina: v('maquina').value, ramAlta: v('ramAlta').checked, manterMin: Number(v('manterMin').value), limiteMin: Number(v('limiteMin').value) };
    }
    const r = await ctxUi.acao('salvarPerfil', {
      id: form.dataset.id || undefined, nome: form.querySelector('#clPerfilNome').value, tarefas, padrao: form.querySelector('#clPerfilPadrao').checked,
    }).catch(() => null);
    if (r) editor.innerHTML = '';
  });
}

function atualizarMaquinas(m) {
  if (!m) return;
  const sel = el.querySelector('#clPerfil');
  const lista = Object.entries(m.perfis).map(([id, p]) => `${id}:${p.nome}:${id === m.padrao}`).join('|');
  if (sel.dataset.lista !== lista) {
    sel.innerHTML = Object.entries(m.perfis).map(([id, p]) => `<option value="${esc(id)}">${esc(p.nome)}${id === m.padrao ? ' ★' : ''}</option>`).join('');
    sel.dataset.lista = lista;
  }
  if (document.activeElement !== sel) sel.value = m.ativo;
  el.querySelector('#clSaldo').textContent = m.saldo != null ? `saldo ${m.saldo.toFixed(2)} unidades` : 'saldo —';
  desenhar(el.querySelector('#clTabela'), tabelaPerfil(m));
  desenhar(el.querySelector('#clLigadas'), ligadas(m));
  desenhar(el.querySelector('#clHistorico'), historico(m));
}

export default {
  montar(raiz, ctx) {
    el = raiz;
    ctxUi = ctx;
    raiz.innerHTML = `
      <style>
        #clMaquinas .tab-maq { width: 100%; border-collapse: collapse; font: 12px var(--mono); }
        #clMaquinas .tab-maq th { text-align: left; font-weight: 500; color: var(--faint); text-transform: uppercase; letter-spacing: .1em; font-size: 10px; padding: 0 10px 6px 0; }
        #clMaquinas .tab-maq td { padding: 7px 10px 7px 0; border-top: 1px solid var(--line-soft); color: var(--muted); }
        #clMaquinas .tab-maq td b { color: var(--text); font-weight: 600; }
        #clMaquinas .maq-ligada { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--line-soft); font-size: 12px; }
        #clMaquinas .maq-ligada.sobra { background: #e5626b14; padding: 8px; border-radius: 4px; }
        #clMaquinas .maq-quando { color: var(--muted); flex: 1; }
        #clMaquinas .hist { display: grid; grid-template-columns: 34px 1fr 54px 76px 90px; gap: 8px; font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--line-soft); color: var(--muted); }
        #clMaquinas .ed-perfil { display: grid; gap: 10px; border: 1px solid var(--amber); border-radius: 6px; padding: 12px 14px; }
        #clMaquinas .ed-tarefa { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; border: 1px solid var(--line-soft); border-radius: 4px; padding: 8px 12px 10px; margin: 0; }
        #clMaquinas .ed-tarefa legend { font: 600 12px var(--mono); color: var(--text); padding: 0 6px; }
        #clMaquinas .ed-check input { width: 18px; height: 18px; }
        #clMaquinas .ed-explica { flex-basis: 100%; margin: 0; font-size: 12px; color: var(--muted); }
        #clMaquinas .ed-ajuda p { margin: 0 0 4px; font-size: 11px; color: var(--muted); }
        #clMaquinas .ed-ajuda b { color: var(--text); }
        @media (max-width: 640px) { #clMaquinas .hist { grid-template-columns: 30px 1fr 70px; } #clMaquinas .hist > :nth-child(3), #clMaquinas .hist > :nth-child(5) { display: none; } }
      </style>
      <div class="cab" style="margin-top:0"><p class="rotulo">Google Colab</p>
        <div class="acoes">${botoesPastas([['notebooks', 'notebooks'], ['status', 'status']])}
          <button class="acao forte" data-abrir="https://colab.research.google.com/">[↗] abrir Colab</button></div></div>
      <section class="bloco" id="clCli" style="padding:16px 18px;display:grid;gap:12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
          <b style="font-weight:600">Rodar sem abrir o navegador <span class="mono" style="font-size:12px;color:var(--faint);font-weight:400">Colab CLI</span></b>
          <span class="mono" id="clCliEstado" style="font-size:12px;color:var(--muted)"></span>
        </div>
        <div class="acoes" style="align-items:end">
          <button class="op" data-acao="transcrever" title="Liga a máquina do perfil, transcreve o que estiver novo em HyperFrames/entrada e desliga">[>] transcrever na GPU</button>
          <label class="campo"><span>composição</span><input id="clComp" placeholder="ex.: sim-pra-tudo" size="18"></label>
          <label class="campo"><span>qualidade</span><select id="clQual"><option>draft</option><option selected>looks</option><option>delivery</option></select></label>
          <button class="op" id="clRender" title="Liga a máquina do perfil (CPU com RAM alta, por padrão), renderiza e desliga">[>] renderizar no Colab</button>
          <button class="acao" data-acao="desligar" data-confirmar="Desligar as VMs do Painel no Colab?" title="Use se cancelou no meio e a VM pode ter ficado ligada">[■] desligar VMs</button>
        </div>
        <div id="clLogin"></div>
        <div id="clProcs"></div>
        <p class="dica" style="margin:0">Cada tarefa roda na máquina do perfil abaixo e é desligada no fim (ou depois do tempo de "manter ligada"). Na primeira vez o Painel pede o login do Google e, se precisar, a autorização do Drive, aqui mesmo.</p>
      </section>
      <section class="bloco" id="clMaquinas" style="padding:16px 18px;display:grid;gap:12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
          <b style="font-weight:600">Máquinas <span class="mono" style="font-size:12px;color:var(--faint);font-weight:400">perfis de configuração</span></b>
          <span class="mono" id="clSaldo" style="font-size:12px;color:var(--muted)"></span>
        </div>
        <div class="acoes" style="align-items:end">
          <label class="campo"><span>perfil em uso</span><select id="clPerfil"></select></label>
          <button class="acao" id="clPerfilEditar">[✎] editar</button>
          <button class="acao" id="clPerfilNovo">[+] novo a partir deste</button>
          <button class="acao" id="clPerfilPadrao2" title="Este perfil já vem escolhido quando o Painel abre">[★] abrir como padrão</button>
          <button class="acao" id="clPerfilApagar">[×] apagar</button>
        </div>
        <div id="clTabela"></div>
        <div id="clEditor"></div>
        <div>
          <div class="acoes" style="justify-content:space-between;align-items:baseline">
            <span class="rotulo" style="margin:0">ligadas agora</span>
            <button class="acao" data-acao="conferirSessoes">[↻] conferir no Colab</button>
          </div>
          <div id="clLigadas"></div>
        </div>
        <div id="clHistorico"></div>
      </section>
      <section class="bloco" id="clVoz" style="padding:16px 18px;display:grid;gap:12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
          <b style="font-weight:600">Gerar narração <span class="mono" style="font-size:12px;color:var(--faint);font-weight:400">Chatterbox · pt-br · máquina do perfil</span></b>
          ${botoesPastas([['voz', 'vozes'], ['referencia', 'referências']])}
        </div>
        <form id="clVozForm" style="display:grid;gap:10px">
          <label class="campo"><span>texto da narração</span><textarea id="clVozTexto" rows="5" maxlength="12000" placeholder="Escreva o roteiro como deve ser falado. Pontuação ajuda nas pausas." style="width:100%;resize:vertical"></textarea></label>
          <div class="acoes" style="align-items:end">
            <label class="campo"><span>nome do arquivo</span><input id="clVozNome" placeholder="ex.: intro-produto" size="18"></label>
            <label class="campo"><span>voz</span><select id="clVozRef"><option value="">padrão do modelo</option></select></label>
            <label class="campo" title="0.25 contida · 0.5 natural · 1+ bem expressiva"><span>expressão</span><input id="clVozExp" type="number" min="0.25" max="1.5" step="0.05" value="0.5" style="width:70px"></label>
            <label class="campo" title="Mais baixo = fala mais solta e lenta; mais alto = segue o texto à risca"><span>ritmo</span><input id="clVozRitmo" type="number" min="0" max="1" step="0.05" value="0.5" style="width:70px"></label>
            <button class="op" type="submit">[>] gerar narração</button>
          </div>
        </form>
        <div id="clVozes"></div>
        <p class="dica" style="margin:0">Gasta unidades do Colab: uns 5 min de preparo na primeira vez (com "manter ligada" no perfil, as próximas começam na hora) e depois quase tempo real. Não usa o Drive, então não pede autorização. Para usar outra voz, ponha um áudio limpo de 10–20 s em <b>voz/referencia</b>, <b>só da sua voz ou de quem autorizou</b>. O .wav sai em HyperFrames/voz, pronto para a composição.</p>
      </section>
      <div id="clServicos" style="display:grid;gap:12px"></div>
      <div class="cab"><p class="rotulo">Notebooks no Drive</p></div>
      <div id="clNotebooks"></div>
      <p class="dica">No Colab: Arquivo → Abrir notebook → Google Drive → EditorVideos/_colab/notebooks. O status aparece aqui sozinho enquanto o notebook roda.</p>`;
    blocoMaquinas(raiz);
    raiz.querySelector('#clRender').addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      await ctxUi.acao('renderizar', { composicao: raiz.querySelector('#clComp').value.trim(), qualidade: raiz.querySelector('#clQual').value }).catch(() => {});
      b.disabled = false;
    });
    raiz.querySelector('#clLogin').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const campo = form.querySelector('#clCodigo');
      form.querySelector('button').disabled = true;
      await ctxUi.acao('enviarCodigo', { id: Number(form.dataset.id), codigo: campo.value.trim() }).catch(() => {});
      form.querySelector('button').disabled = false;
    });
    raiz.querySelector('#clVozForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = (id) => raiz.querySelector(id).value.trim();
      const b = ev.target.querySelector('button');
      b.disabled = true;
      await ctxUi.acao('voz', { texto: v('#clVozTexto'), nome: v('#clVozNome'), referencia: v('#clVozRef'), expressao: v('#clVozExp'), ritmo: v('#clVozRitmo') }).catch(() => {});
      b.disabled = false;
    });
  },

  atualizar(e) {
    if (!el || !e.servicos) return;
    const ocupado = (e.processos || []).some((p) => p.estado === 'rodando' && p.tipo !== 'desligar');
    el.querySelector('#clCliEstado').textContent = !e.cli ? 'não instalado: rode colab-cli/instalar.sh' : ocupado ? 'rodando…' : 'pronto';
    for (const b of el.querySelectorAll('#clCli .op, #clVoz .op')) b.disabled = !e.cli || ocupado;
    // Só troca as opções quando a lista muda, para não perder a escolha.
    const sel = el.querySelector('#clVozRef');
    const refs = (e.referencias || []).map((a) => a.nome);
    if (sel.dataset.lista !== refs.join('|')) {
      const atual = sel.value;
      sel.innerHTML = '<option value="">padrão do modelo</option>' + refs.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
      sel.value = refs.includes(atual) ? atual : '';
      sel.dataset.lista = refs.join('|');
    }
    desenhar(el.querySelector('#clVozes'), lista((e.vozes || []).slice(0, 8).map((a) => linhaArquivo(a, { baixar: true })), 'Nenhuma narração ainda.'));
    atualizarMaquinas(e.maquinas);
    desenhar(el.querySelector('#clLogin'), blocoLogin(e.processos || []));
    desenhar(el.querySelector('#clProcs'), (e.processos || []).length ? lista(e.processos.slice(0, 4).map((p) => autorizacao(p) + linhaProcesso(p)), '') : '');
    desenhar(el.querySelector('#clServicos'), e.servicos.length ? e.servicos.map(servico).join('')
      : '<p class="vazio">Nenhum serviço do Colab ainda. Rode um notebook e ele aparece aqui.</p>');
    desenhar(el.querySelector('#clNotebooks'), lista(e.notebooks.map((a) => linhaArquivo(a, { tocar: false })), 'Nenhum notebook na pasta.'));
  },
};
