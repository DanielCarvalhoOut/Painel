// Aba do FilmCraft: abrir o app conectado e mandar mídia/legendas para a timeline.
import { esc, attr, desenhar, lista, linhaArquivo, botoesPastas } from '/core/ui.js';

let el;

export default {
  montar(raiz) {
    el = raiz;
    raiz.innerHTML = `
      <div class="cab" style="margin-top:0"><p class="rotulo">FilmCraft</p>
        ${botoesPastas([['entrada', 'entrada'], ['transcricao', 'transcrição'], ['saida', 'saída'], ['projetos', 'projetos']])}</div>
      <div class="bloco" id="fcApp" style="padding:16px 18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap"></div>
      <div class="cab"><p class="rotulo">Entrada</p></div>
      <div id="fcEntrada"></div>
      <div class="cab"><p class="rotulo">Legendas (transcrições do Colab)</p></div>
      <div id="fcTransc"></div>
      <div class="cab"><p class="rotulo">Exportados</p></div>
      <div id="fcSaida"></div>`;
  },

  atualizar(e) {
    if (!el || !e.entrada) return;
    const podeImportar = e.controle;
    desenhar(el.querySelector('#fcApp'), `
      <span class="st ${esc(e.status)}">${e.controle ? '[ok]' : e.rodando ? '[~]' : '[ ]'} ${esc(e.rotulo)}</span>
      <span class="mono" style="font-size:12px;color:var(--muted)">${e.versao ? `v${esc(e.versao)} · ` : ''}controle em 127.0.0.1:9876</span>
      <span style="margin-left:auto"></span>
      ${e.controle ? '<span class="nota" style="margin:0">Use [→ timeline] nos arquivos abaixo.</span>'
        : `<button class="btn" data-acao="abrir" ${e.instalado && !e.rodando ? '' : 'disabled'}>Abrir FilmCraft</button>`}
      ${e.resumo ? `<p class="dica" style="width:100%;margin:0">${esc(e.resumo)}</p>` : ''}`);

    const enviar = (a, rotulo) => `<button class="acao forte" data-acao="importar" data-params="${attr({ caminho: a.caminho })}" ${podeImportar ? '' : 'disabled title="Abra o FilmCraft pelo Painel primeiro"'}>${rotulo}</button>`;
    desenhar(el.querySelector('#fcEntrada'), lista(e.entrada.slice(0, 12).map((a) => linhaArquivo(a, { botoes: enviar(a, '[→ timeline]') })), 'Entrada vazia. Baixe no PullCut com destino FilmCraft.'));
    desenhar(el.querySelector('#fcTransc'), lista(e.transcricao.slice(0, 12).map((a) => linhaArquivo(a, {
      botoes: /\.(srt|vtt)$/i.test(a.nome) ? enviar(a, '[→ legendas]') : '',
    })), 'Nenhuma legenda. Rode o notebook de transcrição no Colab com destino FilmCraft.'));
    desenhar(el.querySelector('#fcSaida'), lista(e.saida.slice(0, 10).map((a) => linhaArquivo(a, { baixar: true })), 'Nada exportado ainda.'));
  },
};
