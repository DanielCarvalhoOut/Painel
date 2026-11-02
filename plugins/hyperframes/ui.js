// Aba do HyperFrames: criar composição, prévia, render e as pastas do Drive.
import { esc, attr, desenhar, lista, linhaArquivo, linhaProcesso, botoesPastas, atras } from '/core/ui.js';

let el;

export default {
  montar(raiz, ctx) {
    el = raiz;
    raiz.innerHTML = `
      <div class="cab" style="margin-top:0"><p class="rotulo">HyperFrames</p>
        ${botoesPastas([['entrada', 'entrada'], ['composicoes', 'composições'], ['transcricao', 'transcrição'], ['saida', 'saída']])}</div>

      <form class="bloco" id="hfNova" style="padding:16px 18px;display:grid;gap:14px">
        <p class="rotulo" style="margin:0">Nova composição</p>
        <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:12px">
          <label class="campo"><span>Vídeo da entrada</span><select name="video" required></select></label>
          <label class="campo"><span>Nome</span><input name="nome" placeholder="meu-video" autocomplete="off"></label>
        </div>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
          <div class="opcoes" data-grupo="formato">
            <button type="button" class="op" data-valor="portrait" aria-pressed="true"><span class="ic">[▯]</span>9:16</button>
            <button type="button" class="op" data-valor="landscape" aria-pressed="false"><span class="ic">[▭]</span>16:9</button>
            <button type="button" class="op" data-valor="square" aria-pressed="false"><span class="ic">[□]</span>1:1</button>
          </div>
          <label class="check"><input type="checkbox" name="transcrever"> transcrever aqui (Whisper small, lento neste PC)</label>
          <button class="btn" style="margin-left:auto">Criar</button>
        </div>
        <p class="dica" style="margin:0">Para legendas de qualidade, transcreva no Colab (notebook 1) e importe o .json da pasta transcrição.</p>
      </form>

      <div class="cab"><p class="rotulo">Composições</p><span class="contagem" id="hfContComp"></span></div>
      <div id="hfComps"></div>
      <div class="cab"><p class="rotulo">Processos</p></div>
      <div id="hfProcs"></div>
      <div class="cab"><p class="rotulo">Saída (renders)</p></div>
      <div id="hfSaida"></div>
      <div class="cab"><p class="rotulo">Entrada</p></div>
      <div id="hfEntrada"></div>
      <div class="cab"><p class="rotulo">Transcrições</p></div>
      <div id="hfTransc"></div>`;

    const form = raiz.querySelector('#hfNova');
    form.addEventListener('click', (ev) => {
      const op = ev.target.closest('.op');
      if (!op) return;
      for (const b of op.parentElement.children) b.setAttribute('aria-pressed', String(b === op));
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const botao = form.querySelector('.btn');
      botao.disabled = true;
      try {
        await ctx.acao('criar', {
          video: f.get('video'), nome: f.get('nome'), transcrever: f.get('transcrever') === 'on',
          formato: form.querySelector('[data-grupo=formato] [aria-pressed=true]').dataset.valor,
        });
        form.nome.value = '';
      } catch {} finally {
        botao.disabled = false;
      }
    });
  },

  atualizar(e) {
    if (!el || !e.composicoes) return;
    const select = el.querySelector('[name=video]');
    const opcoes = e.entrada.map((a) => `<option value="${esc(a.caminho)}">${esc(a.nome)}</option>`).join('') || '<option value="">(entrada vazia — baixe no PullCut com destino HyperFrames)</option>';
    if (select.dataset.ultimo !== opcoes) {
      const atual = select.value;
      select.innerHTML = opcoes;
      select.dataset.ultimo = opcoes;
      if ([...select.options].some((o) => o.value === atual)) select.value = atual;
    }
    // Veio de "legendas e efeitos" na Visão geral: já escolhe o vídeo enviado e leva ao formulário.
    let pedido = null;
    try { pedido = sessionStorage.getItem('painel.usar.hyperframes'); } catch {}
    if (pedido && [...select.options].some((o) => o.value === pedido)) {
      try { sessionStorage.removeItem('painel.usar.hyperframes'); } catch {}
      select.value = pedido;
      const form = el.querySelector('#hfNova');
      form.scrollIntoView({ block: 'center', behavior: 'smooth' });
      form.querySelector('[name=nome]').focus({ preventScroll: true });
    }

    el.querySelector('#hfContComp').textContent = `${e.composicoes.length}`;
    desenhar(el.querySelector('#hfComps'), lista(e.composicoes.map((c) => {
      const p = (v) => attr({ composicao: c.nome, qualidade: v });
      return `<div class="item">
        <span class="tp">${c.valida ? '[</>]' : '[?]'}</span>
        <div><div class="nome">${esc(c.nome)}</div><div class="meta">${c.valida ? '' : 'sem index.html · '}${atras(c.modificado)}${c.previa ? ` · prévia em ${esc(c.previa.url)}` : ''}</div></div>
        <div class="acoes">
          ${c.previa
            ? `<button class="acao forte" data-abrir="${esc(c.previa.url)}">[↗] abrir prévia</button><button class="acao" data-cancelar="${c.previa.processo}">[x] parar</button>`
            : `<button class="acao" data-acao="previa" data-params="${attr({ composicao: c.nome })}" ${c.valida ? '' : 'disabled'}>[>] prévia</button>`}
          <button class="acao" data-acao="render" data-params="${p('draft')}" ${c.valida && !c.renderizando ? '' : 'disabled'} title="Rápido, para conferir">render rascunho</button>
          <button class="acao" data-acao="render" data-params="${p('looks')}" ${c.valida && !c.renderizando ? '' : 'disabled'} title="Qualidade final; pesado aqui — o Colab faz mais rápido">render final</button>
          <button class="acao" data-mostrar="${esc(c.caminho)}" title="Mostrar no Explorer">[↗]</button>
        </div>
      </div>`;
    }), 'Nenhuma composição. Crie uma a partir de um vídeo da entrada.'));

    desenhar(el.querySelector('#hfProcs'), lista(e.processos.slice(0, 8).map((p) => linhaProcesso(p, {
      botoes: p.estado === 'concluido' && p.dados?.arquivo ? `<button class="acao" data-tocar="${esc(p.dados.arquivo)}">[>] tocar</button>` : '',
    })), 'Nada rodando.'));
    desenhar(el.querySelector('#hfSaida'), lista(e.saida.slice(0, 10).map((a) => linhaArquivo(a, { baixar: true })), 'Nenhum render ainda.'));
    desenhar(el.querySelector('#hfEntrada'), lista(e.entrada.slice(0, 10).map((a) => linhaArquivo(a)), 'Entrada vazia.'));
    desenhar(el.querySelector('#hfTransc'), lista(e.transcricao.slice(0, 10).map((a) => linhaArquivo(a)), 'Nenhuma transcrição.'));
  },
};
