// Aba do PullCut: a própria interface do PullCut embutida, com uma barra de controle por cima.
import { esc, desenhar, botoesPastas } from '/core/ui.js';

let barraEl;
let quadro;
let ligadoAntes = null;

export default {
  montar(el) {
    el.innerHTML = `
      <div class="cab" style="margin-top:0"><p class="rotulo">PullCut</p><div class="acoes" id="pcBarra"></div></div>
      <div id="pcCorpo"></div>`;
    barraEl = el.querySelector('#pcBarra');
    quadro = el.querySelector('#pcCorpo');
  },

  atualizar(e) {
    const ligado = e.status !== 'off';
    desenhar(barraEl, `
      <span class="st ${esc(e.status)}" style="align-self:center;margin-right:6px">${ligado ? '[ok]' : '[ ]'} ${esc(e.rotulo)}</span>
      ${ligado ? `<button class="acao" data-abrir="${esc(e.url)}">[↗] abrir sozinho</button>` : '<button class="acao forte" data-acao="ligar">[>] ligar PullCut</button>'}
      ${botoesPastas([['downloads', 'downloads']])}`);
    if (ligado === ligadoAntes) return;
    ligadoAntes = ligado;
    quadro.innerHTML = ligado
      ? `<iframe src="${esc(e.url)}/" title="PullCut" style="width:100%;height:calc(100vh - 190px);min-height:560px;border:1px solid var(--line-soft);border-radius:6px;background:var(--bg)"></iframe>`
      : `<div class="bloco" style="padding:28px 24px"><p class="vazio" style="padding:0">O PullCut está desligado.</p><p class="dica">Ele roda separado em ${esc(e.url)}. Ligue por aqui ou pelo PullCut.cmd.</p></div>`;
  },
};
