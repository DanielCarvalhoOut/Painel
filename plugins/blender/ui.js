// Aba Blender: modelos por script (render no PC ou no Colab), 3D por IA a partir de uma imagem (TRELLIS.2 no
// Colab) e a galeria de resultados.
import { esc, attr, desenhar, lista, linhaProcesso, botoesPastas, tamanho, atras } from '/core/ui.js';

let el, ctx;
let escolhida = '';

function cartao(r) {
  const img = r.png ? `<img src="${ctx.urlArquivo(r.png.caminho)}&v=${Math.round(r.png.modificado)}" alt="${esc(r.nome)}" loading="lazy">` : '<div class="semimg">sem render</div>';
  const baixar = (a, rot) => (a ? `<a class="acao" href="${ctx.urlArquivo(a.caminho)}&baixar=1" download="${esc(a.nome)}">[↓] ${rot}</a>` : '');
  return `<figure class="bl-res">
    ${img}
    <figcaption>
      <div class="nome">${esc(r.nome)} <span class="bl-onde">${esc(r.onde || 'PC')}</span></div>
      <div class="meta">${atras(r.modificado)}${r.glb ? ` · glb ${tamanho(r.glb.tamanho)}` : ''}</div>
      <div class="acoes">
        ${baixar(r.png, 'png')}${baixar(r.glb, 'glb')}
        ${r.mp4 ? `<button class="acao" data-tocar="${esc(r.mp4.caminho)}">[>] giro</button>` : ''}
        ${r.blend ? `<button class="acao" data-acao="abrir" data-params="${attr({ caminho: r.blend.caminho })}">[3d] abrir</button>` : ''}
        <button class="acao" data-mostrar="${esc(r.png?.caminho || r.caminho)}" title="Mostrar no Explorer">[↗]</button>
      </div>
    </figcaption>
  </figure>`;
}

function miniatura(a) {
  return `<button type="button" class="bl-mini${a.nome === escolhida ? ' ativa' : ''}" data-escolher="${esc(a.nome)}" title="${esc(a.nome)}" aria-pressed="${a.nome === escolhida}">
    <img src="${ctx.urlArquivo(a.caminho)}&v=${Math.round(a.modificado)}" alt="${esc(a.nome)}" loading="lazy"><span>${esc(a.nome)}</span>
  </button>`;
}

const msg = (id, texto) => { el.querySelector(id).textContent = texto || ''; };

async function rodar(onde) {
  const f = el.querySelector('#blForm');
  const p = { script: f.script.value, nome: f.nome.value.trim() || f.script.value, porcentagem: Number(f.porcentagem.value), amostras: Number(f.amostras.value) };
  if (!p.script) return;
  msg('#blMsg', '');
  try {
    const r = onde === 'colab' ? await ctx.acaoEm('colab', 'blender', p) : await ctx.acao('gerar', p);
    msg('#blMsg', r?.mensagem || 'Iniciado.');
  } catch (e) {
    msg('#blMsg', e.message);
  }
}

async function enviarImagem(arquivo) {
  msg('#blIaMsg', `enviando ${arquivo.name}…`);
  try {
    const r = await fetch(`/api/enviar?plugin=blender&nome=${encodeURIComponent(arquivo.name)}`, { method: 'POST', headers: { 'X-Painel': 'enviar' }, body: arquivo });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
    escolhida = d.arquivo.nome;
    const nome = el.querySelector('#blIaForm').nome;
    if (!nome.value) nome.value = escolhida.replace(/\.[^.]+$/, '');
    msg('#blIaMsg', `${escolhida} pronta.`);
  } catch (e) {
    msg('#blIaMsg', e.message);
  }
}

async function gerarIa() {
  const f = el.querySelector('#blIaForm');
  if (!escolhida) return msg('#blIaMsg', 'Escolha ou envie uma imagem primeiro.');
  msg('#blIaMsg', '');
  try {
    const r = await ctx.acaoEm('colab', 'ia3d', {
      imagem: escolhida, nome: f.nome.value.trim() || escolhida.replace(/\.[^.]+$/, ''),
      qualidade: f.qualidade.value, textura: Number(f.textura.value), faces: Number(f.faces.value),
      amostras: Number(f.amostras.value), giro: Number(f.giro.value),
    });
    msg('#blIaMsg', `${r?.mensagem || 'Iniciado.'} Acompanhe em Processos na aba Colab.`);
  } catch (e) {
    msg('#blIaMsg', e.message);
  }
}

function mostrarHf(s) {
  const t = !s?.token ? 'sem token: o TRELLIS.2 precisa de um para baixar o DINOv3'
    : !s.conferidoEm ? 'token salvo · ainda não conferido'
    : s.dinov3 === 'liberado' ? `token de ${s.usuario} · DINOv3 liberado`
    : s.dinov3 === 'pendente' ? `token de ${s.usuario} · DINOv3 aguardando aprovação da Meta`
    : 'token inválido: crie outro (Read) no Hugging Face';
  el.querySelector('#blHf').textContent = t;
  el.querySelector('#blHf').dataset.ok = String(s?.dinov3 === 'liberado');
}

async function hf(acao, params) {
  try {
    const r = await ctx.acaoEm('colab', acao, params);
    if (acao === 'salvarTokenHF' || acao === 'apagarTokenHF') {
      el.querySelector('#blHfToken').value = '';
      msg('#blIaMsg', r?.mensagem);
      mostrarHf(await ctx.acaoEm('colab', 'statusHF'));
    } else {
      mostrarHf(r);
    }
  } catch (e) {
    msg('#blIaMsg', e.message);
  }
}

export default {
  montar(raiz, c) {
    el = raiz;
    ctx = c;
    raiz.innerHTML = `
      <style>
        .bl-grade { display:grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap:12px; }
        .bl-res { margin:0; border:1px solid var(--line); border-radius:6px; overflow:hidden; background:var(--surface); }
        .bl-res img, .bl-res .semimg { width:100%; aspect-ratio:4/5; object-fit:cover; display:block; background:var(--bg); }
        .bl-res .semimg { display:grid; place-items:center; opacity:.5; font-size:12px; }
        .bl-res figcaption { padding:10px 12px; font-family:var(--mono); font-size:13px; display:flex; flex-direction:column; gap:4px; }
        .bl-res .acoes { display:flex; gap:6px; flex-wrap:wrap; }
        .bl-onde { font-size:11px; color:var(--amber); border:1px solid currentColor; border-radius:3px; padding:0 4px; margin-left:4px; }
        .bl-imagens { display:flex; gap:8px; flex-wrap:wrap; align-items:stretch; }
        .bl-mini { width:96px; padding:0; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--muted); cursor:pointer; overflow:hidden; font:11px var(--mono); }
        .bl-mini img { width:100%; aspect-ratio:1; object-fit:contain; display:block; background:var(--raised); }
        .bl-mini span { display:block; padding:3px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .bl-mini.ativa { border-color:var(--amber); color:var(--text); box-shadow:0 0 0 1px var(--amber); }
        .bl-mini:focus-visible { outline:2px solid var(--amber); outline-offset:2px; }
        .bl-enviar { width:96px; min-height:120px; border:1px dashed var(--line); border-radius:6px; display:grid; place-items:center; text-align:center; color:var(--muted); cursor:pointer; font:12px var(--mono); }
        .bl-enviar:hover, .bl-enviar:focus-within { border-color:var(--amber); color:var(--text); }
        .bl-enviar input { position:absolute; width:1px; height:1px; opacity:0; }
        #blHf { font-family:var(--mono); font-size:12px; color:var(--muted); }
        #blHf[data-ok="true"] { color:var(--ok); }
        #blMsg:empty, #blIaMsg:empty { display:none; }
      </style>
      <div class="cab" style="margin-top:0"><p class="rotulo">Blender <span id="blVersao" class="meta"></span></p>${botoesPastas([['entrada', 'imagens'], ['scripts', 'scripts'], ['saida', 'saída']])}</div>

      <section class="bloco" id="blIa" style="padding:16px 18px;display:grid;gap:12px;margin-bottom:12px">
        <b style="font-weight:600">3D por IA a partir de uma imagem <span class="mono" style="font-size:12px;color:var(--faint);font-weight:400">TRELLIS.2 · Colab · máquina do perfil</span></b>
        <div class="bl-imagens" id="blImagens"></div>
        <form id="blIaForm" class="acoes" style="align-items:end" onsubmit="return false">
          <label class="campo"><span>nome do resultado</span><input name="nome" placeholder="igual à imagem" size="16"></label>
          <label class="campo" title="Resolução da geração: mais alta = mais detalhe e mais tempo de GPU"><span>detalhe</span>
            <select name="qualidade"><option value="512">rápido (512)</option><option value="1024_cascade" selected>alto (1024)</option><option value="1536_cascade">máximo (1536)</option></select></label>
          <label class="campo"><span>textura</span><select name="textura"><option value="1024">1K</option><option value="2048" selected>2K</option><option value="4096">4K</option></select></label>
          <label class="campo" title="Faces do modelo final (depois da limpeza)"><span>faces</span>
            <select name="faces"><option value="200000">200 mil</option><option value="500000" selected>500 mil</option><option value="1000000">1 milhão</option></select></label>
          <label class="campo" title="Amostras do render da vitrine no Blender"><span>amostras</span><input name="amostras" type="number" min="16" max="4096" value="256" style="width:80px"></label>
          <label class="campo" title="Vídeo girando 360° (24 quadros por segundo)"><span>giro</span>
            <select name="giro"><option value="0">sem vídeo</option><option value="72">3 s</option><option value="120">5 s</option></select></label>
          <button class="op" type="button" id="blIaGerar">[☁] gerar 3D no Colab</button>
        </form>
        <p id="blHf" style="margin:0">conferindo token…</p>
        <div class="acoes" style="align-items:end">
          <label class="campo"><span>token do Hugging Face</span><input id="blHfToken" type="password" placeholder="cole o token hf_…" autocomplete="off" size="24"></label>
          <button class="acao" type="button" id="blHfSalvar">[✓] salvar token</button>
          <button class="acao" type="button" id="blHfConferir">[↻] conferir acesso</button>
          <button class="acao" type="button" id="blHfApagar">[x] apagar token</button>
        </div>
        <p class="dica" style="margin:0">Funciona melhor com um objeto ou personagem inteiro, de frente, com fundo simples (o fundo é tirado sozinho). Use só imagens suas ou que você pode usar. Na primeira vez o Colab compila as extensões (uns 20 a 30 min); depois o Painel guarda e as próximas começam bem mais rápido. Precisa de um token de leitura do Hugging Face com acesso aprovado ao <b>DINOv3</b> (licença da Meta); o token fica só neste PC e é apagado da máquina do Colab logo depois de usado.</p>
        <p id="blIaMsg" class="dica" style="margin:0"></p>
      </section>

      <section class="bloco" style="padding:16px 18px;display:grid;gap:12px;margin-bottom:12px">
        <b style="font-weight:600">Renderizar um modelo por script <span class="mono" style="font-size:12px;color:var(--faint);font-weight:400">Cycles · 1080x1350 · .png .glb .blend</span></b>
        <form id="blForm" class="acoes" style="align-items:end" onsubmit="return false">
          <label class="campo"><span>modelo</span><select name="script"></select></label>
          <label class="campo"><span>nome do resultado</span><input name="nome" placeholder="igual ao modelo" size="18"></label>
          <label class="campo" title="100 = 1080x1350"><span>tamanho %</span><input name="porcentagem" type="number" min="10" max="100" value="100" style="width:70px"></label>
          <label class="campo" title="Mais amostras = menos ruído, mais tempo"><span>amostras</span><input name="amostras" type="number" min="16" max="4096" value="128" style="width:80px"></label>
          <button class="op" type="button" id="blPc">[>] renderizar no PC</button>
          <button class="op" type="button" id="blColab">[☁] renderizar no Colab</button>
        </form>
        <p class="dica" style="margin:0">Cada modelo é um script Python em Blender/scripts que monta a cena do zero. No PC roda no processador, sem custo. No Colab usa a GPU do perfil ativo na aba Colab e gasta unidades; o resultado volta para a galeria com o sufixo -colab.</p>
        <p id="blMsg" class="dica" style="margin:0"></p>
      </section>
      <div class="cab"><p class="rotulo">Processos no PC</p></div>
      <div id="blProcs"></div>
      <div class="cab"><p class="rotulo">Resultados</p></div>
      <div id="blRes"></div>`;
    raiz.querySelector('#blPc').addEventListener('click', () => rodar('pc'));
    raiz.querySelector('#blColab').addEventListener('click', () => rodar('colab'));
    raiz.querySelector('#blIaGerar').addEventListener('click', gerarIa);
    raiz.querySelector('#blImagens').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-escolher]');
      if (!b) return;
      escolhida = b.dataset.escolher;
      for (const x of raiz.querySelectorAll('.bl-mini')) {
        x.classList.toggle('ativa', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      }
      const nome = raiz.querySelector('#blIaForm').nome;
      if (!nome.value) nome.placeholder = escolhida.replace(/\.[^.]+$/, '');
    });
    raiz.querySelector('#blImagens').addEventListener('change', (ev) => {
      if (ev.target.matches('input[type=file]') && ev.target.files[0]) enviarImagem(ev.target.files[0]);
    });
    raiz.querySelector('#blHfSalvar').addEventListener('click', () => hf('salvarTokenHF', { token: raiz.querySelector('#blHfToken').value }));
    raiz.querySelector('#blHfConferir').addEventListener('click', () => { msg('#blIaMsg', ''); el.querySelector('#blHf').textContent = 'conferindo no Hugging Face…'; hf('conferirHF'); });
    raiz.querySelector('#blHfApagar').addEventListener('click', () => hf('apagarTokenHF'));
    ctx.acaoEm('colab', 'statusHF').then(mostrarHf).catch(() => mostrarHf(null));
  },

  atualizar(e) {
    el.querySelector('#blVersao').textContent = e.versao ? `· ${e.versao}` : (e.app ? '' : '· não encontrado');
    const sel = el.querySelector('#blForm').script;
    const atual = sel.value;
    const opcoes = (e.scripts || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (sel.dataset.opcoes !== opcoes) {
      sel.innerHTML = opcoes || '<option value="">nenhum script</option>';
      sel.dataset.opcoes = opcoes;
      if (atual) sel.value = atual;
    }
    const imagens = e.imagens || [];
    if (!escolhida && imagens[0]) escolhida = imagens[0].nome;
    desenhar(el.querySelector('#blImagens'), `${imagens.map(miniatura).join('')}
      <label class="bl-enviar">[+] enviar<br>imagem<input type="file" accept="image/png,image/jpeg,image/webp"></label>`);
    desenhar(el.querySelector('#blProcs'), lista((e.processos || []).slice(0, 6).map((p) => linhaProcesso(p)), 'Nenhum render no PC ainda.'));
    desenhar(el.querySelector('#blRes'), (e.resultados || []).length
      ? `<div class="bl-grade">${e.resultados.map(cartao).join('')}</div>`
      : '<p class="vazio">Nenhum resultado. Escolha um modelo e renderize.</p>');
  },
};
