# Guia para a IA: pilotar o estúdio pelo Painel

O Painel é a central de um estúdio de vídeo local: **PullCut** (captura por URL), **Colab** (GPU na nuvem), **HyperFrames** (criação e animação em HTML), **Blender** (modelos 3D por script) e **FilmCraft** (montagem na timeline). Ele foi feito para ser usado de dois jeitos: a pessoa clica, ou pede a você. Os dois usam **os mesmos controles**, e tudo que você faz aparece ao vivo na tela dela (processos, progresso, ícone flutuante). Prefira sempre agir pelo Painel, para a pessoa ver e poder cancelar.

Responda em português. Leia `README.md` (Painel) e `..\HyperFrames\README.md` antes de mexer em algo que não conhece.

## Ligar e conferir

- Endereço: http://127.0.0.1:4700 (só local). Se não responder: `node server.mjs` nesta pasta, em segundo plano.
- `GET /api/estado`: estado de todos os plugins (processos, arquivos, métricas).
- `GET /api/plugins`: manifestos (ações, pastas, perfil de cada ferramenta) e `receitas`.

## Agir

| O quê | Como |
|---|---|
| Ação de um plugin | `POST /api/plugins/<id>/acao` com o cabeçalho `Content-Type: application/json` e o JSON `{"acao": "<nome>", ...params}` |
| Enviar um arquivo | `POST /api/enviar?plugin=hyperframes&nome=<arquivo>` com o arquivo no corpo e o cabeçalho `X-Painel: enviar` |
| Cancelar um processo | `POST /api/core` `{"acao": "cancelar", "id": N}` (também com `Content-Type: application/json`) |

Todo POST sem `Content-Type: application/json` volta 415 (menos `/api/enviar`). Exemplo: `curl -s -X POST http://127.0.0.1:4700/api/plugins/blender/acao -H "Content-Type: application/json" -d '{"acao":"gerar","script":"microfone"}'`

Ações principais:

| Plugin | Ação | Parâmetros | Faz |
|---|---|---|---|
| colab | `transcrever` | `arquivo` (nome em HyperFrames/entrada, opcional), `perfil` | liga a GPU do perfil, transcreve, desliga (ou mantém, se o perfil mandar). **Gasta unidades do Colab da pessoa** |
| colab | `renderizar` | `composicao`, `qualidade`, `perfil` | render na máquina do perfil (CPU com RAM alta no Econômico). Gasta unidades |
| colab | `voz` | `texto` (até 12000 caracteres), `nome`, `referencia` (arquivo em HyperFrames/voz/referencia, opcional), `expressao` (0.25–1.5), `ritmo` (0–1), `perfil` | narração pt-br com o Chatterbox na GPU do perfil → `HyperFrames/voz/<nome>.wav`. Gasta unidades; ~5 min de preparo. Clonar voz só de quem consentiu |
| colab | `blender` | `script` (nome em Blender/scripts, sem .py), `nome`, `porcentagem` (10–100), `amostras`, `perfil` | render 3D na GPU do Colab → `Blender/saida/<nome>-colab`. Gasta unidades |
| colab | `usarPerfil` / `salvarPerfil` / `apagarPerfil` / `definirPadrao` | `id` / `id`, `nome`, `tarefas` / `id` / `id` | perfis de máquina (qual VM cada tarefa usa). Todas as tarefas aceitam `perfil` (id); sem ele vale o perfil ativo |
| colab | `conferirSessoes` / `desligarSessao` | — / `sessao` | lista as VMs ligadas no Colab / desliga uma |
| colab | `desligar` | — | desliga as VMs do Painel (use se algo foi cancelado) |
| colab | `ia3d` | `imagem` (arquivo em Blender/entrada), `nome`, `qualidade` (512, 1024_cascade, 1536_cascade), `textura` (1024, 2048, 4096), `faces`, `amostras`, `giro` (quadros, 0 = sem vídeo), `perfil` | imagem → 3D com o TRELLIS.2 numa GPU de 24 GB + vitrine no Blender → `Blender/saida/<nome>-ia`. Gasta unidades; a primeira vez compila por uns 20 a 30 min |
| colab | `statusHF` / `conferirHF` / `apagarTokenHF` | — | token do Hugging Face (DINOv3). **Quem cola o token é a pessoa** (`salvarTokenHF`), nunca você |
| blender | `gerar` | `script`, `nome`, `porcentagem`, `amostras` | render 3D no PC (CPU, sem custo) → `Blender/saida/<nome>` (.png, .glb, .blend) |
| blender | `abrir` | `caminho` (.blend em Blender/saida) | abre no Blender com interface |
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

- qualquer coisa que gaste unidades do Colab (`transcrever`, `renderizar`, `voz`, `blender` do Colab, `ia3d`), dizendo o que vai rodar e em qual máquina;
- `hyperframes publish`, `cloud`, `auth`, `--engine heygen`: mandam o conteúdo para a HeyGen;
- apagar arquivos da pessoa;
- baixar vídeos de terceiros: só conteúdo próprio, licenciado ou autorizado;
- instalar programas: confira origem, versão e assinatura ou checksum, instale dentro da pasta da ferramenta, desligue telemetria e passe o Defender.

## Cuidados que já custaram tempo

- O Drive do PC (`G:`) demora a subir arquivos: logo depois de um envio grande, o Colab pode dizer "Nada novo". Espere a sincronização.
- O Colab CLI roda pelo WSL (`colab-cli/rodar.sh`). Se pedir login ou autorização do Drive, a aba Colab mostra os botões. Peça à pessoa para clicar.
- Não faça commit nem push sem a pessoa pedir.
