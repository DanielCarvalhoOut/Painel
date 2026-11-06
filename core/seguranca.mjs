// Proteção das rotas. Escutar só em 127.0.0.1 não basta: uma página aberta no navegador ainda consegue
// mandar pedidos para cá. Três barreiras complementares, para todas as rotas:
// - Host conhecido: barra DNS rebinding (um domínio externo que passa a apontar para 127.0.0.1).
// - Escrita (POST etc.) só da própria origem: Origin, quando vem, tem de ser o Painel; Sec-Fetch-Site também.
// - Corpo JSON só com Content-Type application/json: obriga o navegador a pedir licença (CORS) antes,
//   então um formulário ou fetch "simples" de outro site não chega a executar a ação.
// Pedidos sem Origin (curl, a IA pelo terminal) continuam funcionando. Não é autenticação: qualquer
// programa rodando no próprio PC ainda pode falar com o Painel.

const LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

// Rotas de escrita cujo corpo não é JSON (o envio manda o arquivo cru).
const CORPO_CRU = new Set(['/api/enviar']);

export function criarChecagem(porta) {
  const hosts = new Set(['127.0.0.1', 'localhost', '[::1]'].map((h) => `${h}:${porta}`));
  const origens = new Set([...hosts].map((h) => `http://${h}`));

  // Devolve null se o pedido pode seguir, ou [status, mensagem] para recusar.
  return function checar(req, rota) {
    if (!hosts.has(String(req.headers.host || '').toLowerCase())) return [421, 'Host não permitido.'];
    const site = req.headers['sec-fetch-site'];
    if (rota.startsWith('/api/') && site === 'cross-site') return [403, 'Pedido de outro site recusado.'];
    if (LEITURA.has(req.method)) return null;
    const origem = req.headers.origin;
    if (origem !== undefined && !origens.has(origem)) return [403, 'Origem não permitida.'];
    if (site && site !== 'same-origin' && site !== 'none') return [403, 'Pedido de outra origem recusado.'];
    if (!CORPO_CRU.has(rota) && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return [415, 'Use Content-Type: application/json.'];
    }
    return null;
  };
}
