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

export default {
  montar(raiz, ctx) {
    el = raiz;
    ctxUi = ctx;
    raiz.innerHTML = `
      <div class="cab" style="margin-top:0"><p class="rotulo">Google Colab</p>
        <div class="acoes">${botoesPastas([['notebooks', 'notebooks'], ['status', 'status']])}
          <button class="acao forte" data-abrir="https://colab.research.google.com/">[↗] abrir Colab</button></div></div>
      <section class="bloco" id="clCli" style="padding:16px 18px;display:grid;gap:12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
          <b style="font-weight:600">Rodar sem abrir o navegador <span class="mono" style="font-size:12px;color:var(--faint);font-weight:400">Colab CLI</span></b>
          <span class="mono" id="clCliEstado" style="font-size:12px;color:var(--muted)"></span>
        </div>
        <div class="acoes" style="align-items:end">
          <button class="op" data-acao="transcrever" title="Liga uma T4, transcreve o que estiver novo em HyperFrames/entrada e desliga">[>] transcrever na GPU</button>
          <label class="campo"><span>composição</span><input id="clComp" placeholder="ex.: sim-pra-tudo" size="18"></label>
          <label class="campo"><span>qualidade</span><select id="clQual"><option>draft</option><option selected>looks</option><option>delivery</option></select></label>
          <button class="op" id="clRender" title="Liga uma VM de CPU com RAM alta, renderiza e desliga">[>] renderizar no Colab</button>
          <button class="acao" data-acao="desligar" data-confirmar="Desligar as VMs do Painel no Colab?" title="Use se cancelou no meio e a VM pode ter ficado ligada">[■] desligar VMs</button>
        </div>
        <div id="clLogin"></div>
        <div id="clProcs"></div>
        <p class="dica" style="margin:0">A VM sempre é desligada no fim. Na primeira vez o Painel pede o login do Google e, se precisar, a autorização do Drive, aqui mesmo.</p>
      </section>
      <section class="bloco" id="clVoz" style="padding:16px 18px;display:grid;gap:12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
          <b style="font-weight:600">Gerar narração <span class="mono" style="font-size:12px;color:var(--faint);font-weight:400">Chatterbox na T4 · pt-br</span></b>
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
        <p class="dica" style="margin:0">Gasta unidades do Colab: uns 5 min de preparo e depois quase tempo real. Para usar outra voz, ponha um áudio limpo de 10–20 s em <b>voz/referencia</b>, <b>só da sua voz ou de quem autorizou</b>. O .wav sai em HyperFrames/voz, pronto para a composição.</p>
      </section>
      <div id="clServicos" style="display:grid;gap:12px"></div>
      <div class="cab"><p class="rotulo">Notebooks no Drive</p></div>
      <div id="clNotebooks"></div>
      <p class="dica">No Colab: Arquivo → Abrir notebook → Google Drive → EditorVideos/_colab/notebooks. O status aparece aqui sozinho enquanto o notebook roda.</p>`;
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
    desenhar(el.querySelector('#clLogin'), blocoLogin(e.processos || []));
    desenhar(el.querySelector('#clProcs'), (e.processos || []).length ? lista(e.processos.slice(0, 4).map((p) => autorizacao(p) + linhaProcesso(p)), '') : '');
    desenhar(el.querySelector('#clServicos'), e.servicos.length ? e.servicos.map(servico).join('')
      : '<p class="vazio">Nenhum serviço do Colab ainda. Rode um notebook e ele aparece aqui.</p>');
    desenhar(el.querySelector('#clNotebooks'), lista(e.notebooks.map((a) => linhaArquivo(a, { tocar: false })), 'Nenhum notebook na pasta.'));
  },
};
