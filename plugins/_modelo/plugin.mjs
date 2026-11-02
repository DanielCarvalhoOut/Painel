// Modelo de plugin. Para criar um novo: copie esta pasta para plugins/<id> (sem "_" no começo),
// troque o id para o nome da pasta e reinicie o Painel. Contrato completo em LEIAME.md.

import path from 'node:path';

export default {
  id: '_modelo',                 // igual ao nome da pasta
  nome: 'Meu plugin',
  logo: 'logo.svg',               // opcional: arquivo em ui/, aparece no cartão
  icone: '[*]',                  // ASCII curto, aparece em abas, cartões e no resumo
  descricao: 'O que ele faz, numa linha.',
  tipo: 'conector',              // 'ambiente' (editor), 'conector' (outro app/serviço local) ou 'servico' (remoto)
  ordem: 50,                     // posição nas abas e cartões
  papel: 'Integração',           // função no estúdio, aparece no resumo da visão geral

  // Valores padrão; painel.config.json → plugins.<id> sobrescreve. Como função, recebe a base geral
  // { drive, ferramentas } do painel.config.json.
  padroes: (g) => ({ pasta: path.join(g.ferramentas, 'MeuPlugin') }),

  // Pastas que o Painel pode abrir, listar e tocar para este plugin (nada fora delas).
  pastas: (cfg) => ({ saida: path.join(cfg.pasta, 'saida') }),

  // Opcional: roda uma vez quando o Painel sobe.
  async iniciar(ctx) {},

  // Obrigatório: o Painel chama a cada poucos segundos. Responda rápido (limite de 6 s).
  async estado(ctx) {
    const arquivos = await ctx.arquivos.listar(ctx.pastas.saida);
    return {
      status: 'ok',                       // ok | aviso | erro | off
      rotulo: 'pronto',                   // texto curto do status
      resumo: null,                       // frase opcional no cartão
      metricas: [['Arquivos', String(arquivos.length)]],
      ocupado: false,                     // true = trabalhando agora (destaca no resumo)
      atalhos: [{ acao: 'ola', rotulo: '[>] testar' }],  // botões no cartão da visão geral
      atividade: [],                      // itens extras na lista de atividade
      arquivos,                           // qualquer outro dado que a sua ui.js use
    };
  },

  // Ações chamadas pela interface: ctx.acao('ola', {...}) ou <button data-acao="ola">.
  acoes: {
    async ola(params, ctx) {
      return { mensagem: 'Olá do plugin modelo.' };
    },
  },
};
