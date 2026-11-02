# Guia para a IA: pilotar o estúdio pelo Painel

O Painel é a central de um estúdio de vídeo local: **PullCut** (captura por URL), **Colab** (GPU na nuvem), **HyperFrames** (criação e animação em HTML) e **FilmCraft** (montagem na timeline). Ele foi feito para ser usado de dois jeitos: a pessoa clica, ou pede a você. Os dois usam **os mesmos controles**, e tudo que você faz aparece ao vivo na tela dela (processos, progresso, ícone flutuante). Prefira sempre agir pelo Painel, para a pessoa ver e poder cancelar.

Responda em português. Leia `README.md` (Painel) e `..\HyperFrames\README.md` antes de mexer em algo que não conhece.

## Ligar e conferir

- Endereço: http://127.0.0.1:4700 (só local). Se não responder: `node server.mjs` nesta pasta, em segundo plano.
- `GET /api/estado`: estado de todos os plugins (processos, arquivos, métricas).
- `GET /api/plugins`: manifestos (ações, pastas, perfil de cada ferramenta) e `receitas`.

## Agir

| O quê | Como |
|---|---|
| Ação de um plugin | `POST /api/plugins/<id>/acao` com JSON `{"acao": "<nome>", ...params}` |
| Enviar um arquivo | `POST /api/enviar?plugin=hyperframes&nome=<arquivo>` com o arquivo no corpo e o cabeçalho `X-Painel: enviar` |
| Cancelar um processo | `POST /api/core` `{"acao": "cancelar", "id": N}` |

Ações principais:

| Plugin | Ação | Parâmetros | Faz |
|---|---|---|---|
| colab | `transcrever` | `arquivo` (nome em HyperFrames/entrada, opcional) | liga uma T4, transcreve, desliga. **Gasta unidades do Colab da pessoa** |
| colab | `renderizar` | `composicao`, `qualidade` | render numa VM de CPU com RAM alta. Gasta unidades |
| colab | `voz` | `texto` (até 12000 caracteres), `nome`, `referencia` (arquivo em HyperFrames/voz/referencia, opcional), `expressao` (0.25–1.5), `ritmo` (0–1) | narração pt-br com o Chatterbox numa T4 → `HyperFrames/voz/<nome>.wav`. Gasta unidades; ~5 min de preparo. Clonar voz só de quem consentiu |
| colab | `desligar` | — | desliga as VMs do Painel (use se algo foi cancelado) |
| colab | `login` / `enviarCodigo` | — / `id`, `codigo` | login do Colab CLI. **O código quem cola é a pessoa**, nunca você |
| hyperframes | `criar` | `video` (caminho na entrada), `nome`, `formato` (portrait, landscape, square) | cria uma composição |
| hyperframes | `previa` / `render` | `composicao` / `composicao`, `qualidade` (draft, looks, delivery) | prévia no navegador / render local |
| filmcraft | `abrir` / `importar` / `montar` | — / `caminho` / `caminho` | abre o app / manda mídia ou .srt para a timeline / abre e importa |
| pullcut | `ligar` | — | liga o PullCut (porta 4747) |

As receitas da Visão geral (`receitas.json`) descrevem os caminhos entre as ferramentas. Os passos `"onde": "ia"` são seus: hoje não têm botão.

## Trabalho de criação (HyperFrames)

Para compor, animar, legendar, gerar voz, tirar fundo ou usar blocos do catálogo, use as skills em `..\HyperFrames\.claude\skills` (`hyperframes`, `hyperframes-cli`, `hyperframes-registry`, `media-use`). Binário: `..\HyperFrames\node_modules\.bin\hyperframes`, sempre com `HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1`.

- Narração natural: ação `voz` do Colab (acima). Rápida e grátis, mas mais robótica: `hyperframes tts ... --voice pf_dora|pm_alex|pm_santa --lang pt-br`, com `HYPERFRAMES_PYTHON=..\HyperFrames\.tts-venv\Scripts\python.exe`.
- Tirar fundo é lento no CPU deste PC (3 s de vídeo ≈ 70 s). Avise antes de vídeo longo.
- Renderize a partir de uma cópia local (`..\HyperFrames\_render\<nome>`), nunca lendo do `G:`. O botão de render do Painel já faz isso.
- `render` pode sair com código 0 sem MP4: confira o arquivo.

## Pergunte antes de

- qualquer coisa que gaste unidades do Colab (`transcrever`, `renderizar`, `voz`), dizendo o que vai rodar;
- `hyperframes publish`, `cloud`, `auth`, `--engine heygen`: mandam o conteúdo para a HeyGen;
- apagar arquivos da pessoa;
- baixar vídeos de terceiros: só conteúdo próprio, licenciado ou autorizado;
- instalar programas: confira origem, versão e assinatura ou checksum, instale dentro da pasta da ferramenta, desligue telemetria e passe o Defender.

## Cuidados que já custaram tempo

- O Drive do PC (`G:`) demora a subir arquivos: logo depois de um envio grande, o Colab pode dizer "Nada novo". Espere a sincronização.
- O Colab CLI roda pelo WSL (`colab-cli/rodar.sh`). Se pedir login ou autorização do Drive, a aba Colab mostra os botões. Peça à pessoa para clicar.
- Não faça commit nem push sem a pessoa pedir.
