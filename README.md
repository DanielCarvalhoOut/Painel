# Painel — o estúdio de vídeo com IA que roda até em PC fraco

O Painel é o **arquiteto** de um estúdio de vídeo: ele não edita nem renderiza sozinho, ele **orquestra** ferramentas que já existem e manda o trabalho pesado para a nuvem. A ideia central é **terceirizar o processamento para o Google Colab**: transcrição com Whisper, narração com voz natural e render longo rodam numa GPU do Google, ligada e desligada pelo próprio Painel, enquanto o seu PC só mostra, organiza e faz a prévia. Foi feito e testado num notebook sem placa de vídeo (Ryzen 3, 10 GB de RAM).

Tudo pode ser feito de dois jeitos: **clicando** nos botões ou **pedindo para uma IA** (Claude Code) que usa os mesmos botões, e você acompanha tudo ao vivo na tela.

```
                    ┌──────────────── Painel (este repositório) ────────────────┐
  seus vídeos  ──▶  │ envio · receitas · processos ao vivo · plugins · API p/ IA │
                    └──────┬──────────────┬──────────────┬──────────────┬───────┘
                           ▼              ▼              ▼              ▼
                     Google Colab    HyperFrames      FilmCraft       PullCut
                   (GPU na nuvem)  (criar/animar)    (timeline)    (baixar por URL)
                           └──────── Google Drive: pastas compartilhadas ────────┘
```

## De quem são as ferramentas

O Painel é deste repositório (licença MIT). As outras são **utilitários de terceiros**, instalados à parte, cada um com a sua licença. O Painel só conversa com eles; nenhum código deles está aqui.

| Ferramenta | Papel no estúdio | Autor | Licença | Onde |
|---|---|---|---|---|
| **Painel** | arquiteto: interface, orquestração, API para a IA | este repositório | MIT | aqui |
| **Google Colab** + [Colab CLI](https://github.com/googlecolab/google-colab-cli) | força na nuvem: GPU T4, VMs com RAM alta | Google | serviço do Google · CLI Apache-2.0 | conta Google (Colab Pro recomendado) |
| [**HyperFrames**](https://github.com/heygen-com/hyperframes) | criação e animação: vídeo feito de HTML, legendas, blocos prontos | HeyGen | Apache-2.0 | `npm` |
| [**FilmCraft**](https://github.com/storytold/filmcraft) | montagem na timeline | storytold | MIT / Apache-2.0 | download do release |
| [**PullCut**](https://github.com/DanielCarvalhoOut/PullCut) | captura de vídeo por URL (usa o [yt-dlp](https://github.com/yt-dlp/yt-dlp), Unlicense) | mesmo autor do Painel | MIT | repositório próprio |

Modelos que rodam no Colab: [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT, SYSTRAN) com os pesos Whisper da OpenAI (MIT) e [Chatterbox](https://github.com/resemble-ai/chatterbox) (MIT, Resemble AI). Voz local opcional: Kokoro (Apache-2.0), pelo HyperFrames.

| Ferramenta | Papel | O que faz |
|---|---|---|
| [↓] PullCut | Captura | baixa vídeo, trecho ou áudio por URL (só conteúdo seu, licenciado ou autorizado) |
| [☁] Colab | Força na nuvem | transcrição (Whisper), narração (Chatterbox) e render pesados |
| [</>] HyperFrames | Criação e animação | vídeo em HTML: animação, legendas, voz, tirar fundo, blocos prontos |
| [\|\|\|] FilmCraft | Montagem | timeline, cortes, legendas `.srt` |

Não há uma ordem fixa: as ferramentas se combinam conforme o vídeo. Nenhuma é obrigatória além do Painel: plugin sem a ferramenta instalada só aparece como desligado.

## Começar

Pré-requisitos: Windows 10/11, [Node.js 22+](https://nodejs.org), [Google Drive para computador](https://www.google.com/drive/download/), [FFmpeg](https://ffmpeg.org) no `PATH` (ex.: `winget install Gyan.FFmpeg`) e, para o Colab pelo Painel, o WSL com Ubuntu (`wsl --install -d Ubuntu`).

1. **Pasta do estúdio.** Crie uma pasta (ex.: `D:\Estudio`) e clone este repositório dentro dela como `Painel`. As ferramentas ficam ao lado:
   ```
   D:\Estudio\
     Painel\        este repositório
     HyperFrames\   npm i hyperframes@0.8.225 (veja abaixo)
     FilmCraft\app\ o FilmCraft portátil descompactado
     PullCut\       o repositório do PullCut
   ```
2. **Config.** Copie `painel.config.exemplo.json` para `painel.config.json` e ajuste:
   - `drive`: a pasta do Drive que o Colab também vai ver, ex.: `G:\\Meu Drive\\EditorVideos`. Dentro dela o Painel cria `HyperFrames\`, `FilmCraft\` e `_colab\`.
   - `ferramentas`: a pasta do estúdio; vazio = a pasta que contém o `Painel`.
   - em `plugins.<id>`, qualquer caminho pode ser trocado um por um (`app`, `drive`, `projetos`…).
3. **HyperFrames:** na pasta `HyperFrames`, `npm i hyperframes@0.8.225`. Desligue a telemetria (`HYPERFRAMES_NO_TELEMETRY=1`; o Painel já passa isso nos processos dele). Para a IA saber usar o HyperFrames, instale as skills dele só nessa pasta: `npx skills@1.7.4 add heygen-com/hyperframes -s hyperframes -s hyperframes-cli -s hyperframes-registry -s media-use -a claude-code --copy -y`.
4. **FilmCraft:** baixe o build portátil para Windows nos [releases](https://github.com/storytold/filmcraft/releases) e descompacte em `FilmCraft\app\`. Se a versão não for a 0.15.0, ajuste `plugins.filmcraft.app` na config.
5. **Colab (opcional, mas é o forte):** `wsl -d Ubuntu -- bash colab-cli/instalar.sh` dentro da pasta do Painel. Ele baixa o uv e o Colab CLI conferindo o SHA-256. O login é feito pela própria aba Colab na primeira tarefa. Use a **mesma conta Google** no Colab e no Drive do PC.
6. **Notebooks:** `node notebooks/gerar.mjs` copia os notebooks para `<drive>\_colab\notebooks`.
7. Abra com `Painel.cmd` → http://127.0.0.1:4700 (só local, sem dependências npm).

Para a IA: abra o Claude Code na pasta do estúdio. O guia que ela segue está em [`CLAUDE.md`](CLAUDE.md).

## Responsabilidade

- Baixe e processe só conteúdo **seu, licenciado ou autorizado**.
- Clonar voz só **com consentimento** da pessoa dona da voz.
- Tarefas no Colab **gastam as suas unidades de computação**; o Painel sempre desliga a VM no fim e tem o botão *desligar VMs*.

## Abas

| Aba | O que faz |
|---|---|
| Visão geral | "O que você quer fazer?" (receitas), os dois jeitos de usar, **enviar vídeo**, um cartão por ferramenta (forte, usos, não é para) e a atividade |
| PullCut | A interface do PullCut embutida (ele roda na porta 4747). O Painel liga o PullCut se estiver desligado |
| Colab | Andamento de cada notebook: etapa, progresso, GPU, RAM e log. Lista os notebooks do Drive |
| HyperFrames | Criar composição a partir da entrada, prévia, render rascunho/final, arquivos |
| FilmCraft | Abre o app conectado e manda mídia e legendas `.srt` para a timeline |

## O que cada ferramenta faz de melhor

| Ferramenta | Papel | Forte em | Não é para |
|---|---|---|---|
| PullCut | Captura | trazer mídia de uma URL, inteira ou só um trecho | editar |
| Colab | Força na nuvem | o trabalho pesado: transcrição com GPU, render longo | criar ou editar; é o motor |
| HyperFrames | Criação e animação | vídeo feito de HTML: animações, títulos, legendas animadas, voz a partir de texto, tirar fundo, gráficos, vídeo a partir de site | cortar horas de material bruto |
| FilmCraft | Montagem | timeline: cortar, ordenar, trilha, ajuste fino de legendas | animação e efeitos gerados |

Cada plugin declara isso no próprio manifesto (`perfil: { forte, usos, naoE }`), e a Visão geral mostra nos cartões.

## O que você quer fazer? (receitas e combos)

O topo da Visão geral lista **objetivos**, não ferramentas: legendas animadas, corte vertical, vídeo explicativo sem gravar, vinheta, recorte, vídeo de produto… Cada receita mostra o caminho entre as ferramentas, com cada passo marcado **painel** (tem botão) ou **IA** (peça no chat), e traz a frase pronta para pedir à IA. As receitas estão em `receitas.json`: editar não exige reiniciar, e uma receita só aparece se todas as ferramentas dela estiverem ativas. As marcadas *experimental* funcionam, mas com ressalvas (a voz pt-br pode soar robótica; tirar fundo é lento no CPU).

## Dois jeitos de usar

- **Manual:** pelos botões.
- **Pela IA:** peça em português ao Claude Code aberto na pasta do estúdio. Ele usa a mesma API dos botões (`/api/plugins/<id>/acao`, `/api/enviar`), então tudo aparece ao vivo no Painel e você pode cancelar ou assumir. O guia que a IA lê está em `CLAUDE.md`.

## Enviar seus vídeos

Na Visão geral: arraste os vídeos (ou clique e escolha). Eles vão para `HyperFrames/entrada` no Drive, de onde o Colab também lê. Quando o envio termina, o Painel pergunta o que fazer com cada um:

| Opção | Ferramenta | O que acontece |
|---|---|---|
| transcrever na GPU | Colab | roda o notebook 1 só para esse arquivo (Colab CLI). Vídeo grande: espere o Drive terminar de subir, senão o Colab responde "Nada novo" |
| legendas e efeitos | HyperFrames | abre a aba com o vídeo já escolhido em *Nova composição* |
| cortar e montar | FilmCraft | abre o FilmCraft se estiver fechado e põe o vídeo na mídia do projeto |

O vídeo pronto sai com **[↓] baixar** nas listas de saída do HyperFrames e do FilmCraft.

Como funciona: `POST /api/enviar?plugin=<id>&nome=<arquivo>` grava aos poucos (sem carregar o vídeo na memória) como `.<nome>.parcial` oculto e só renomeia no fim, então nenhum notebook ou render pega um vídeo pela metade. Envio cancelado ou conexão perdida apagam o parcial. Não sobrescreve (`nome (2).mp4`). Aceita só os formatos de vídeo e áudio. Exige o cabeçalho `X-Painel: enviar` e a mesma origem, para que outro site aberto no navegador não consiga gravar arquivos no seu PC.

## Arquitetura (modular)

```
Painel/
  server.mjs           núcleo: HTTP, eventos ao vivo (SSE), rotas genéricas
  painel.config.json   sua config (fora do git; modelo em painel.config.exemplo.json): drive, ferramentas, porta, plugins
  core/                util, processos (spawn + log + progresso), arquivos (pastas permitidas + player), carregador de plugins
  public/              casca da interface + /core/ui.js (helpers) + base.css + globo.js
  plugins/<id>/        plugin.mjs (servidor) + ui.js (aba, opcional)
  plugins/_modelo/     modelo e documentação para criar plugins novos (LEIAME.md)
  notebooks/           notebooks do Colab (gerados por gerar.mjs e copiados para o Drive)
```

O núcleo não sabe nada de PullCut, HyperFrames etc. Um plugin novo (conector para outro app, outro serviço na nuvem, outro editor) é só uma pasta nova em `plugins/` — veja `plugins/_modelo/LEIAME.md`. Para desligar um, ponha o id em `desativados` no `painel.config.json`.

Segurança: escuta só em 127.0.0.1; arquivos só podem ser abertos, listados ou tocados dentro das pastas que cada plugin declara.

## Colab

Os notebooks gravam `EditorVideos/_colab/status/<serviço>.json` no Drive (batimento a cada 15 s); o Drive para computador traz o arquivo para o PC e o Painel mostra. Sem atualização por mais de 2 min enquanto "rodando" = **sem sinal** (sessão caiu ou pediu confirmação).

| Notebook | Máquina | Faz |
|---|---|---|
| `1_transcrever.ipynb` | GPU T4 | faster-whisper 1.1.1 (`large-v3-turbo`) → `<projeto>/transcricao/<nome>.json` (palavras, formato do HyperFrames), `.srt`, `.vtt` |
| `2_renderizar.ipynb` | CPU, RAM alta | Node 22.20.0 (SHA-256 conferido) + hyperframes 0.8.225 sem telemetria → `HyperFrames/saida/<nome>_<data>_colab.mp4` |
| `3_voz.ipynb` | GPU T4 | [Chatterbox Multilingual](https://github.com/resemble-ai/chatterbox) 0.1.7 (MIT), pt-br → `HyperFrames/voz/<nome>.wav`. O texto é dividido em blocos de até 260 caracteres (blocos longos saíam cortados) e juntado com pausas. Uns 5 min de preparo (instalação e modelo), depois perto de tempo real |

**Narração (aba Colab → Gerar narração):** cole o roteiro, dê um nome e clique. *Expressão* (0.25–1.5) deixa a fala mais contida ou mais animada; *ritmo* (0–1) mais baixo deixa a fala mais solta, mais alto segue o texto à risca. Para outra voz, ponha um áudio limpo de 10–20 s em `HyperFrames/voz/referencia` e escolha no campo *voz*: **só a sua voz ou de quem autorizou**. Pelo CLI o .wav volta direto da VM (não espera o Drive) e o Painel copia para `HyperFrames/voz`.

No Colab: Arquivo → Abrir notebook → Google Drive → `EditorVideos/_colab/notebooks`. Para mudar um notebook, edite `notebooks/gerar.mjs` e rode `node notebooks/gerar.mjs` (regera e copia para o Drive).

Formato do status: `servico, notebook, estado (rodando|concluido|erro), etapa, progresso, mensagem, log[], gpu{nome, uso, memoria_usada_mb, memoria_total_mb}, ram{usada_mb, total_mb}, inicio, atualizado` (ms).

### Colab CLI: rodar sem abrir o navegador

Com o [Colab CLI oficial](https://github.com/googlecolab/google-colab-cli) (`google-colab-cli` 0.7.5, Apache-2.0, publicado no PyPI com atestado assinado), o Painel liga a VM, monta o Drive, executa o notebook e **sempre desliga a VM no fim**. Na aba Colab ficam os botões *transcrever na GPU*, *renderizar no Colab*, *gerar narração* e *desligar VMs*. O andamento continua chegando pelo mesmo JSON de status.

O CLI só roda em Linux e macOS, então aqui ele roda pelo **WSL (Ubuntu 24.04, Python 3.12)**:

| Arquivo | Faz |
|---|---|
| `colab-cli/instalar.sh` | Sem `sudo`: baixa o uv 0.13.1 e o wheel do CLI, confere os dois por SHA-256 e instala o venv em `~/.editorvideos/colab-cli` no WSL (o `/mnt/d` é lento e instável para venv). Rodar, na pasta do Painel: `wsl -d Ubuntu -- bash colab-cli/instalar.sh` |
| `colab-cli/login.cmd` | Login **uma vez** pelo terminal (alternativa ao login pela aba): abre um link, você entra com a conta do Colab Pro (a mesma do Drive do PC) e cola o código. O token fica em `~/.config/colab-cli/token.json` no WSL |
| `colab-cli/rodar.sh` | `transcrever [ARQUIVO]` (T4), `renderizar COMPOSICAO [QUALIDADE]` (CPU com RAM alta), `login` e `parar` (desliga as VMs). O Painel chama este script |

**Login pela aba Colab:** se uma tarefa falhar por falta de login (ou token expirado), aparece **[>] fazer login agora**. O Painel roda `rodar.sh login`, pega o link do Google no log e mostra **[↗] abrir login do Google** e um campo para colar o código; o código vai direto para a entrada do CLI (não fica no log). Depois é só clicar de novo no que você tentou rodar.

Ícone flutuante nas rodadas pelo CLI: enquanto a VM liga, o Drive monta e o Drive do PC ainda não trouxe o status, a etapa vem do log do CLI ("ligando a VM", "montando o Google Drive", "célula 3/4 · …"). Quando o JSON de status desta rodada chega, ele assume. Se a rodada estiver esperando você (login, autorização do Drive), o detalhe do ícone fica aberto.

Como o notebook sabe que veio do CLI: o `rodar.sh` passa `EDITORVIDEOS_CLI=1`, então o notebook não chama `drive.mount()` (o `colab drivemount` já montou; o `drive.mount()` ficaria esperando um navegador). Os parâmetros (`ARQUIVO`, `COMPOSICAO`, `QUALIDADE`…) também chegam por variável de ambiente.

Cuidados:
- Sem login, as tarefas param na hora com "Falta o login…" (em vez de travar esperando o código) e a aba oferece o login.
- A primeira montagem do Drive pode pedir autorização extra: o CLI mostra um link do Google e espera um Enter. O Painel reconhece essa linha no log e mostra na aba Colab **[↗] autorizar Drive** (abre o link) e **[>] já autorizei** (manda o Enter pela entrada do processo, `ctx.processos.enviar`). Essa autorização vale **para cada VM** (o link é "ephem"), então pode ser pedida de novo em outras tarefas; se ninguém aprovar, a montagem expira e a VM é desligada.
- Pelo WSL existe `/dev/tty` mesmo sem terminal, e o CLI esperaria o Enter ali. Por isso, quando não há terminal, o `rodar.sh` roda o `drivemount` com `setsid` (sem terminal de controle), e o CLI passa a ler da entrada. Num terminal de verdade continua tudo normal.
- Cancelar o processo no Painel não garante que a VM caiu: use **desligar VMs**. As unidades de computação aparecem com `colab usage`.
- Na checagem de 2026-10-31 o código do CLI não tinha telemetria (grep por telemetry/analytics/clearcut vazio), e o Defender não achou ameaças em `colab-cli/` nem no venv.

## Problemas conhecidos (e o que já está resolvido)

Achados no primeiro vídeo feito de ponta a ponta pelo pipeline (2026-10-31). As correções já estão no código. Esta lista explica o sintoma, para quem topar com ele de novo.

### Colab

| Sintoma | Causa | Solução |
|---|---|---|
| "Nada novo para transcrever" e aparece uma pasta **`EditorVideos (1)`** vazia no Drive | A montagem do Drive no Colab estava velha e não enxergava a `EditorVideos` vinda do PC; o notebook criava outra | O notebook remonta o Drive (`force_remount`) e **para com erro** se `EditorVideos/HyperFrames` não aparecer, em vez de criar pasta. Se acontecer: apague a `EditorVideos (1)`, **Ambiente de execução → Desconectar e excluir ambiente de execução** e rode de novo |
| Notebook não aparece na busca do Colab | Drive para computador pausado (arquivo `%LOCALAPPDATA%\Google\DriveFS\user-paused`) | Retomar a sincronização no ícone do Drive |
| Colab e PC "não veem" os mesmos arquivos | Colab logado em outra conta Google | Colab, Drive web e Drive para computador precisam estar **na mesma conta** |
| `open() got an unexpected keyword argument 'metadata_errors'` | O PyAV novo do Colab removeu um argumento que o faster-whisper 1.1.1 usa | O áudio é decodificado pelo `ffmpeg` do Colab (`ler_audio`) e entregue pronto ao Whisper |
| `Library libcublas.so.12 is not found or cannot be loaded` | O Colab passou a vir com outro CUDA; o ctranslate2 do faster-whisper procura o 12 | A célula 3 instala `nvidia-cublas-cu12` e `nvidia-cudnn-cu12==9.*` e pré-carrega as bibliotecas com `ctypes` antes do modelo |
| Mudou o notebook no PC e o Colab continua rodando o antigo | O Colab mantém aberta a cópia que carregou; o Drive pode demorar a subir a nova | Feche a aba e reabra pelo Drive, ou **Arquivo → Fazer upload de notebook** a partir de `Painel/notebooks/` |
| Emoji vira quadradinho no render do Colab | O Linux do Colab não tem fonte de emoji colorido | A célula 3 do `2_renderizar` instala `fonts-noto-color-emoji` |
| `operator torchvision::nms does not exist` no `3_voz` | O Chatterbox fixa o torch 2.6 e o torchvision do Colab fica incompatível, quebrando o transformers | A célula de instalação remove o torchvision (a voz não usa) |

Para conferir uma correção sem refazer tudo: rode só a célula que falhou (as variáveis das anteriores continuam na sessão).

### Render do HyperFrames no PC

| Sintoma | Causa | Solução |
|---|---|---|
| `Audio track failed … Invalid data found when processing input` e **Render failed** (às vezes em uns áudios, às vezes em outros) | O render lia a composição direto do `G:` (Drive em modo transmissão); leituras simultâneas falham de forma intermitente | O botão de render do Painel copia a composição para `HyperFrames/_render/<nome>`, renderiza ali, grava em `HyperFrames/renders/` e depois copia o MP4 para `G:\…\HyperFrames\saida` |
| `EISDIR … link … video-state-lock` ao rodar `check` no `G:` | O Drive não aceita hard link | Aviso só do relatório; o check vale. Para trabalhar sem ele, use a cópia local |
| `check` acusa `audio_source_unreadable … ffprobe not found` | FFmpeg fora do `PATH` do terminal | O Painel já põe o FFmpeg no `PATH` dos processos. No terminal: `export PATH="<pasta bin do FFmpeg>:$PATH"` |
| A CLI termina com código 0 mas não há MP4 | O `render` sai com 0 mesmo com "Render failed" (ex.: mixagem de áudio bloqueada) | O Painel confere se o arquivo existe e marca erro com a linha do log; o notebook do Colab também |
| Efeitos sonoros em `.mp3` falhando na mixagem | Ver a primeira linha | Prefira `.wav` em `assets/sfx` (decodificação trivial) |

## Testar sem atrapalhar o Painel aberto

```bash
PAINEL_PORT=4701 node server.mjs
```
