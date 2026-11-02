// Helpers de interface para os plugins. Um plugin importa daqui o que precisar:
//   import { esc, barra, linhaArquivo, linhaProcesso, desenhar } from '/core/ui.js';
//
// Botões declarativos (a casca trata o clique, o plugin só escreve o HTML):
//   data-acao="nome" data-params='{"x":1}'  → ação do próprio plugin (POST /api/plugins/<id>/acao)
//   data-pasta="saida"                      → abre a pasta declarada no manifesto
//   data-mostrar="C:\..."                   → mostra o arquivo no Explorer
//   data-tocar="C:\..."                     → abre o player do Painel
//   data-cancelar="12"                      → cancela um processo
//   data-ir="hyperframes"                   → muda de aba
//   data-abrir="http://..."                 → abre em nova aba do navegador

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const attr = (obj) => esc(JSON.stringify(obj));

export function barra(pct, largura = 20) {
  if (pct === null || pct === undefined) return `<span class="barra"><span class="vazia">[${'·'.repeat(largura)}]</span></span>`;
  const cheio = Math.round((Math.max(0, Math.min(100, pct)) / 100) * largura);
  return `<span class="barra">[${'#'.repeat(cheio)}<span class="vazia">${'·'.repeat(largura - cheio)}</span>] ${String(Math.round(pct)).padStart(3)}%</span>`;
}

const SIMBOLOS = { concluido: '[ok]', erro: '[!]', cancelado: '[x]', 'sem-sinal': '[?]', parado: '[ ]', ok: '[ok]', off: '[ ]', aviso: '[~]' };
export function simbolo(estado) {
  if (estado === 'rodando') return '<span class="spin" aria-label="rodando"></span>';
  return esc(SIMBOLOS[estado] || '[·]');
}

export function tamanho(bytes) {
  if (!bytes && bytes !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

export function atras(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(ms).toLocaleDateString('pt-BR');
}

export function duracao(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

const ICONE_TIPO = { video: '[>]', audio: '[~]', legenda: '[T]', outro: '[·]' };

// Uma linha de arquivo. botoes: HTML extra (ex.: ação de importar). tocar=false esconde o play.
// baixar: true põe um link de download (vídeo pronto saindo do estúdio).
export function linhaArquivo(a, { botoes = '', tocar = true, baixar = false } = {}) {
  const tocavel = tocar && ['video', 'audio', 'legenda'].includes(a.tipo);
  if (baixar) botoes += `<a class="acao" href="/api/arquivo?caminho=${encodeURIComponent(a.caminho)}&baixar=1" download="${esc(a.nome)}">[↓] baixar</a>`;
  return `<div class="item">
    <span class="tp">${ICONE_TIPO[a.tipo] || '[·]'}</span>
    <div><div class="nome" title="${esc(a.nome)}">${esc(a.nome)}</div><div class="meta">${tamanho(a.tamanho)} · ${atras(a.modificado)}</div></div>
    <div class="acoes">
      ${tocavel ? `<button class="acao" data-tocar="${esc(a.caminho)}">${a.tipo === 'legenda' ? '[T] ver' : '[>] tocar'}</button>` : ''}
      ${botoes}
      <button class="acao" data-mostrar="${esc(a.caminho)}" title="Mostrar no Explorer">[↗]</button>
    </div>
  </div>`;
}

// Uma linha de processo (render, prévia, CLI…) com barra, log e cancelar.
export function linhaProcesso(p, { botoes = '' } = {}) {
  const tempo = p.fim ? `levou ${duracao(p.fim - p.inicio)}` : `${duracao(Date.now() - p.inicio)} rodando`;
  return `<div class="item proc ${esc(p.estado)}" data-chave="p${p.id}">
    <span class="tp">${simbolo(p.estado)}</span>
    <div>
      <div class="nome">${esc(p.titulo)}</div>
      <div class="meta">${esc(p.estado)} · ${tempo}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>` : ''}</div>
      ${p.erro ? `<div class="msg-erro">${esc(p.erro)}</div>` : ''}
      ${p.log?.length ? `<details><summary>log (${p.log.length} linhas)</summary><pre class="log">${esc(p.log.slice(-60).join('\n'))}</pre></details>` : ''}
    </div>
    <div>${barra(p.estado === 'concluido' && p.progresso === null ? 100 : p.progresso, 14)}</div>
    <div class="acoes">
      ${botoes}
      ${p.estado === 'rodando' ? `<button class="acao" data-cancelar="${p.id}">[x] cancelar</button>` : ''}
    </div>
  </div>`;
}

export function lista(itens, vazio) {
  return itens.length ? `<div class="lista">${itens.join('')}</div>` : `<p class="vazio">${esc(vazio)}</p>`;
}

export function botoesPastas(pastas) {
  return `<div class="pastas">${pastas.map(([chave, rotulo]) => `<button class="acao" data-pasta="${esc(chave)}"><span class="ic">[/]</span>${esc(rotulo)}</button>`).join('')}</div>`;
}

// Troca o HTML só se mudou — não reseta foco, rolagem nem <details> aberto à toa.
const ultimo = new WeakMap();
export function desenhar(el, html) {
  if (!el || ultimo.get(el) === html) return;
  const abertos = [...el.querySelectorAll('details[open]')].map((d) => d.closest('[data-chave]')?.dataset.chave).filter(Boolean);
  ultimo.set(el, html);
  el.innerHTML = html;
  for (const chave of abertos) el.querySelector(`[data-chave="${CSS.escape(chave)}"] details`)?.setAttribute('open', '');
}
