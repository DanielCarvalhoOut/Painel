// Globo terrestre em ASCII, em 3D, girando — a marca do Painel. Cada caractere é um ponto da
// esfera: luz difusa e borda escurecida dão volume, o oceano tem brilho especular, a grade de
// meridianos e paralelos mostra a rotação e um halo fino faz a atmosfera.

// Continentes por faixa de 7,5° de latitude (90N → 90S); cada par é [coluna inicial, final]
// em colunas de 7,5° de longitude a partir de -180°.
const TERRA = [
  [],
  [[11, 14], [16, 21], [26, 26], [37, 38]],
  [[2, 5], [7, 14], [16, 21], [26, 47]],
  [[1, 15], [17, 19], [21, 21], [25, 47]],
  [[5, 10], [13, 15], [23, 23], [25, 46]],
  [[7, 16], [23, 41], [42, 42]],
  [[7, 14], [22, 27], [29, 41], [42, 42]],
  [[8, 13], [22, 40], [42, 42]],
  [[9, 10], [13, 13], [22, 28], [29, 35], [36, 39], [40, 40]],
  [[10, 12], [13, 13], [21, 28], [29, 31], [33, 35], [36, 38], [40, 40]],
  [[12, 12], [14, 15], [22, 30], [34, 34], [37, 38], [40, 40]],
  [[13, 17], [23, 29], [37, 39]],
  [[13, 19], [25, 29], [37, 40], [41, 43]],
  [[13, 19], [25, 29], [38, 39], [41, 42]],
  [[14, 18], [25, 28], [30, 30], [39, 43]],
  [[14, 17], [26, 28], [39, 44]],
  [[14, 16], [26, 27], [39, 43], [47, 47]],
  [[14, 15], [43, 43], [47, 47]],
  [[14, 15]],
  [],
  [],
  [[0, 10], [20, 47]],
  [[0, 47]],
  [[0, 47]],
];
const MAPA = TERRA.map((faixas) => {
  const linha = new Float32Array(48);
  for (const [a, b] of faixas) for (let c = a; c <= b; c++) linha[c] = 1;
  return linha;
});

// Amostra bilinear: suaviza o mapa de 7,5° e arredonda as costas.
function terra(lat, lon) {
  const fy = Math.min(22.999, Math.max(0, (90 - lat) / 7.5 - 0.5));
  const fx = (lon + 180) / 7.5 - 0.5;
  const y0 = Math.floor(fy);
  const x0 = Math.floor(fx);
  const ty = fy - y0;
  const tx = fx - x0;
  const a = (((x0 % 48) + 48) % 48);
  const b = (a + 1) % 48;
  const l0 = MAPA[y0];
  const l1 = MAPA[y0 + 1];
  return (l0[a] * (1 - tx) + l0[b] * tx) * (1 - ty) + (l1[a] * (1 - tx) + l1[b] * tx) * ty;
}

const normal = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const LUZ = normal([-0.6, 0.5, 0.75]);
const MEIO = normal([LUZ[0], LUZ[1], LUZ[2] + 1]);   // vetor meio-caminho (Blinn) para o brilho
const INCLINACAO = (23.4 * Math.PI) / 180;
const SEN_I = Math.sin(INCLINACAO);
const COS_I = Math.cos(INCLINACAO);
const RAMPA = '.,:;=+*#%@';
const GRAU = 180 / Math.PI;
const MARGEM = 1.12;  // espaço em volta da esfera para o halo

// Monta um quadro com o globo girado `rot` radianos. Devolve HTML com uma classe de tom por trecho.
export function quadro(linhas, rot) {
  // Caractere monoespaçado ≈ 0,6 da altura da linha: mais colunas que linhas para ficar redondo.
  const colunas = Math.round(linhas / 0.6) | 1;
  let html = '';
  for (let r = 0; r < linhas; r++) {
    let classe = null;
    let trecho = '';
    const emitir = () => {
      if (trecho) html += classe ? `<i class="${classe}">${trecho}</i>` : trecho;
      trecho = '';
    };
    for (let c = 0; c < colunas; c++) {
      const x = (((c + 0.5) / colunas) * 2 - 1) * MARGEM;
      const y = (1 - ((r + 0.5) / linhas) * 2) * MARGEM;
      const d = x * x + y * y;
      let ch = ' ';
      let cl = null;
      if (d > 1) {
        // Atmosfera: anel fino, só do lado iluminado.
        const borda = (Math.sqrt(d) - 1) / (MARGEM - 1);
        const lado = (x * LUZ[0] + y * LUZ[1]) / Math.sqrt(d);
        if (borda < 0.55) [ch, cl] = ['·', lado > -0.2 ? 'a' : 'a0'];
      } else {
        const z = Math.sqrt(1 - d);
        const difusa = Math.max(0, x * LUZ[0] + y * LUZ[1] + z * LUZ[2]);
        const luz = difusa * (0.55 + 0.45 * z);  // borda escurecida dá profundidade
        const yi = y * COS_I - z * SEN_I;
        const zi = y * SEN_I + z * COS_I;
        const lat = Math.asin(Math.max(-1, Math.min(1, yi))) * GRAU;
        let lon = (Math.atan2(x, zi) + rot) * GRAU;
        lon = ((((lon + 180) % 360) + 360) % 360) - 180;
        if (terra(lat, lon) > 0.5) {
          const i = Math.min(RAMPA.length - 1, Math.floor((0.08 + luz * 0.92) * RAMPA.length));
          ch = RAMPA[Math.max(1, i)];
          cl = `t${1 + Math.min(4, Math.floor(luz * 5))}`;
        } else {
          const brilho = Math.pow(Math.max(0, x * MEIO[0] + y * MEIO[1] + z * MEIO[2]), 60);
          const meridiano = Math.abs(((lon % 30) + 45) % 30 - 15) > 15 - 1.6 / Math.max(0.25, z);
          const paralelo = Math.abs(((lat % 30) + 45) % 30 - 15) > 13.6;
          if (brilho > 0.35) [ch, cl] = [brilho > 0.7 ? '*' : '+', 's'];
          else if ((meridiano || paralelo) && luz > 0.04) [ch, cl] = [paralelo && meridiano ? '+' : meridiano ? '¦' : '-', 'g'];
          else if (luz > 0.5) [ch, cl] = [':', 'o3'];
          else if (luz > 0.22) [ch, cl] = ['·', 'o2'];
          else if (luz > 0.04) [ch, cl] = ['.', 'o1'];
          else [ch, cl] = ['.', 'o0'];  // lado noturno: apagado, mas mantém a silhueta da esfera
        }
      }
      if (cl !== classe) {
        emitir();
        classe = cl;
      }
      trecho += ch;
    }
    emitir();
    html += '\n';
  }
  return html;
}

// Liga um <pre> ao globo: rotação contínua pelo relógio (sem trancos), ~30 quadros/s,
// pausa fora da tela; fica parado só com animacoes: "sistema" + Windows pedindo menos movimento.
export function girarGlobo(pre, { linhas = 21, grausPorSegundo = 10 } = {}) {
  const inicio = -0.6;
  const desenhar = (rot) => { pre.innerHTML = quadro(linhas, rot); };
  desenhar(inicio);
  if (document.documentElement.classList.contains('movimento-reduzido')) return;
  const velocidade = (grausPorSegundo * Math.PI) / 180 / 1000;
  let ultimo = 0;
  let base = performance.now();
  let acumulado = inicio;
  const passo = (agora) => {
    requestAnimationFrame(passo);
    const visivel = !document.hidden && pre.offsetParent !== null;
    if (!visivel) { base = agora; return; }
    acumulado += (agora - base) * velocidade;
    base = agora;
    if (agora - ultimo < 33) return;
    ultimo = agora;
    desenhar(acumulado);
  };
  requestAnimationFrame(passo);
}
