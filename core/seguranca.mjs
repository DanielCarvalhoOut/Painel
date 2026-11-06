// Proteção das rotas. Escutar só em 127.0.0.1 não basta: uma página aberta no navegador ainda consegue
// mandar pedidos para cá. Barreiras complementares, para todas as rotas:
// - Host conhecido: barra DNS rebinding (um domínio externo que passa a apontar para 127.0.0.1).
// - Métodos: só GET, HEAD e POST. OPTIONS (pré-voo de CORS) é recusado, então nenhum outro site ganha licença.
// - Leitura da API só da própria origem: Sec-Fetch-Site "cross-site" e "same-site" (outra porta de localhost,
//   como um servidor de desenvolvimento qualquer) não leem /api/.
// - Escrita (POST) só da própria origem: Origin, quando vem, tem de ser o Painel; Sec-Fetch-Site também.
// - Corpo JSON só com Content-Type application/json, e o envio de arquivo só com o cabeçalho X-Painel: os dois
//   obrigam o navegador a pedir licença (CORS) antes, então um formulário ou fetch "simples" não chega aqui.
// - Cabeçalhos de resposta: o Painel não abre dentro de iframe de ninguém (sem clickjacking, que faria um clique
//   enganado parecer "da própria origem") e outros sites não embutem os arquivos servidos.
// Pedidos sem Origin (curl, a IA pelo terminal) continuam funcionando. Não é autenticação: qualquer
// programa rodando no próprio PC ainda pode falar com o Painel.

const LEITURA = new Set(['GET', 'HEAD']);
const PERMITIDOS = new Set(['GET', 'HEAD', 'POST']);

// Rotas de escrita cujo corpo não é JSON (o envio manda o arquivo cru) e o cabeçalho que elas exigem.
export const CORPO_CRU = { '/api/enviar': ['x-painel', 'enviar'] };

// Vão em toda resposta (server.mjs aplica antes de qualquer rota).
export const CABECALHOS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function criarChecagem(porta) {
  const hosts = new Set(['127.0.0.1', 'localhost', '[::1]'].map((h) => `${h}:${porta}`));
  const origens = new Set([...hosts].map((h) => `http://${h}`));

  // Devolve null se o pedido pode seguir, ou [status, mensagem] para recusar.
  return function checar(req, rota) {
    if (!hosts.has(String(req.headers.host || '').toLowerCase())) return [421, 'Host não permitido.'];
    if (!PERMITIDOS.has(req.method)) return [405, 'Método não permitido.'];
    const site = req.headers['sec-fetch-site'];
    if (rota.startsWith('/api/') && (site === 'cross-site' || site === 'same-site')) return [403, 'Pedido de outro site recusado.'];
    if (LEITURA.has(req.method)) return null;
    const origem = req.headers.origin;
    // "null" (iframe com sandbox, arquivo local) também cai aqui: não está na lista.
    if (origem !== undefined && !origens.has(origem)) return [403, 'Origem não permitida.'];
    if (site && site !== 'same-origin' && site !== 'none') return [403, 'Pedido de outra origem recusado.'];
    const cru = CORPO_CRU[rota];
    if (cru) return req.headers[cru[0]] === cru[1] ? null : [403, 'Envio recusado.'];
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return [415, 'Use Content-Type: application/json.'];
    return null;
  };
}
