# Como criar um plugin do Painel

Um plugin é uma pasta em `Painel/plugins/<id>/`. O Painel acha sozinho ao subir. Pastas que começam com `_` (como esta) são ignoradas.

```
plugins/<id>/
  plugin.mjs   obrigatório: manifesto + estado + ações (roda no servidor, Node)
  ui.js        opcional: interface da aba (roda no navegador)
  ui/          opcional: arquivos extras da interface, servidos em /plugins/<id>/ui/...
```

Para começar: copie `_modelo` para `plugins/meu-plugin`, troque `id: 'meu-plugin'` e reinicie o Painel (feche a janela "Painel - servidor" e rode `Painel.cmd`).

Para desligar um plugin sem apagar, coloque o id em `desativados` no `painel.config.json`.

## plugin.mjs

`export default { ... }` com:

| campo | obrigatório | o que é |
|---|---|---|
| `id` | sim | igual ao nome da pasta |
| `nome` | sim | nome mostrado |
| `estado(ctx)` | sim | função assíncrona que diz como o plugin está (ver abaixo) |
| `icone` | não | ASCII curto, ex. `[↓]`, `[</>]`, `[☁]` |
| `flutuante` | não | `true` se o plugin pode mostrar o andamento num ícone flutuante nas outras abas (o usuário liga/desliga no cartão) |
| `logo` | não | arquivo em `ui/` (`logo.svg` ou `.png`) mostrado no topo do cartão; sem logo, o cartão usa o `icone` |
| `descricao` | não | uma linha |
| `tipo` | não | `ambiente`, `conector` ou `servico` |
| `ordem` | não | posição nas abas e cartões (menor primeiro) |
| `papel` | não | a função dele no estúdio em poucas palavras (ex. `Captura`, `Montagem`); aparece no resumo da visão geral junto da `descricao` |
| `recebe` | não | `{ pasta, tipos, rotulo }`: este plugin guarda os vídeos enviados na Visão geral (na pasta declarada em `pastas`). `tipos`: `['video', 'audio']`. Só um plugin precisa declarar |
| `usar` | não | o que o plugin oferece fazer com um arquivo enviado: `[{ rotulo, descricao, acao, aviso }]` chama a ação com `{ caminho, arquivo }`; `{ rotulo, descricao, ir: true }` abre a aba e grava o caminho em `sessionStorage['painel.usar.<id>']` para a interface escolher o arquivo |
| `perfil` | não | `{ forte, usos: [], naoE }`: o que a ferramenta faz de melhor, para que usar e para que não usar. Aparece no cartão da Visão geral. Seja honesto: só o que foi testado |
| `padroes` | não | configuração padrão (objeto, ou função que recebe `{ drive, ferramentas }` do `painel.config.json`); `painel.config.json → plugins.<id>` sobrescreve |
| `pastas` | não | `{ chave: caminho }` ou `(config) => ({...})`. Só essas pastas podem ser abertas, listadas e tocadas |
| `iniciar(ctx)` | não | roda uma vez ao subir (criar pastas, ligar um serviço) |
| `acoes` | não | `{ nome: async (params, ctx) => resultado }`. Devolva `{ mensagem }` para mostrar um aviso; lance `Error` para mostrar erro |
| `rotas(req, res, url, ctx)` | não | rotas HTTP próprias em `/api/plugins/<id>/...`; devolva `true` se respondeu |
| `encerrar(ctx)` | não | roda ao fechar o Painel |

### O que `estado()` devolve

```js
{
  status: 'ok' | 'aviso' | 'erro' | 'off',
  rotulo: 'pronto',                 // curto: aparece no topo, nas abas e no cartão
  resumo: 'frase opcional',
  metricas: [['Rótulo', 'valor'], ...],
  ocupado: true,                    // trabalhando agora: destaca a ferramenta no resumo
  flutuante: { titulo, detalhe, progresso, estado },  // com manifesto.flutuante: o que o ícone flutuante mostra (null esconde)
  atalhos: [{ acao: 'ligar', rotulo: '[>] ligar', params: {} }],  // botões no cartão
  atividade: [{ titulo, estado: 'rodando'|'concluido'|'erro'|..., progresso, detalhe, quando }],
  // ...qualquer outro dado que a sua ui.js precise
}
```

O Painel acrescenta `processos` (os processos que o plugin iniciou com `ctx.processos`). Se `estado()` passar de 6 s ou der erro, o plugin aparece como erro, mas o resto do Painel segue normal.

### O `ctx` do servidor

| | |
|---|---|
| `ctx.config` | `padroes` + o trecho do `painel.config.json` |
| `ctx.pastas` | as pastas resolvidas |
| `ctx.dir` | a pasta do plugin |
| `ctx.util` | `slug`, `carimbo`, `portaAberta`, `portaLivre`, `buscarJson`, `processoRodando`, `abrirNoExplorer` |
| `ctx.arquivos` | `listar(dir, ['video','audio','legenda'])`, `listarPastas`, `dentroDe`, `permitido` |
| `ctx.processos` | `iniciar({ tipo, titulo, comando, args, cwd, env, alvo, dados, url, lerLinha, aoTerminar })`, `ativos()`, `listar()`, `obter(id)`, `cancelar(id)`, `enviar(id, texto)` (escreve na entrada do processo, ex.: o Enter que um CLI espera). O progresso é lido de qualquer `NN%` no log |
| `ctx.publicar(evento, dados)` | avisa a interface ao vivo (use o evento `'plugin'` para pedir atualização) |
| `ctx.log(...)` | escreve no console do Painel com o prefixo do plugin |

## ui.js

```js
import { esc, desenhar, lista, linhaArquivo, linhaProcesso, botoesPastas, barra } from '/core/ui.js';
export default {
  montar(el, ctx) { /* uma vez, ao abrir a aba */ },
  atualizar(estado, ctx) { /* a cada estado novo */ },
};
```

`ctx` no navegador: `acao(nome, params)`, `avisar(texto, 'ok'|'erro')`, `abrirPlayer(caminho)`, `irPara(id)`, `estado()`, `atualizar()`, `urlArquivo(caminho)`.

Botões declarativos, sem JavaScript:

| atributo | faz |
|---|---|
| `data-acao="nome" data-params='{"x":1}'` | chama a ação do plugin |
| `data-confirmar="Tem certeza?"` | pede confirmação antes |
| `data-pasta="saida"` | abre a pasta do manifesto |
| `data-mostrar="C:\..."` | mostra o arquivo no Explorer |
| `data-tocar="C:\..."` | abre o player (vídeo, áudio ou legenda) |
| `linhaArquivo(a, { baixar: true })` | põe um link [↓] baixar (download do arquivo) |
| `data-cancelar="12"` | cancela um processo |
| `data-ir="hyperframes"` | muda de aba |
| `data-abrir="http://..."` | abre numa aba nova |

Use as classes de `/core/base.css` (`bloco`, `cab`, `rotulo`, `btn`, `op`, `acao`, `item`, `lista`, `campo`, `dica`, `vazio`) para manter o visual.
