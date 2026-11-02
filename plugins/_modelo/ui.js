// Interface do plugin (opcional — sem ui.js o plugin só aparece no cartão da visão geral).
import { esc, desenhar, lista, linhaArquivo, botoesPastas } from '/core/ui.js';

let el;

export default {
  // Chamado uma vez, na primeira vez que a aba é aberta.
  montar(raiz, ctx) {
    el = raiz;
    raiz.innerHTML = `
      <div class="cab" style="margin-top:0"><p class="rotulo">${esc(ctx.manifesto.nome)}</p>${botoesPastas([['saida', 'saída']])}</div>
      <button class="btn" data-acao="ola">Testar ação</button>
      <div class="cab"><p class="rotulo">Arquivos</p></div>
      <div id="lista"></div>`;
  },

  // Chamado a cada estado novo (polling + eventos ao vivo).
  atualizar(estado) {
    desenhar(el.querySelector('#lista'), lista(estado.arquivos.map((a) => linhaArquivo(a)), 'Pasta vazia.'));
  },
};
