// Gera os notebooks do Colab (.ipynb) a partir deste arquivo e copia para o Drive.
// Rodar: node notebooks/gerar.mjs   (o código de status é o mesmo em todos os notebooks)

import { writeFile, mkdir, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configGeral } from '../core/plugins.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// A pasta do Drive vem do painel.config.json ("drive" ou plugins.colab.drive), como no Painel.
const config = JSON.parse(await readFile(path.join(AQUI, '..', 'painel.config.json'), 'utf8').catch(() => '{}'));
const DRIVE = path.join(config.plugins?.colab?.drive || path.join(configGeral(config, path.join(AQUI, '..', 'plugins')).drive, '_colab'), 'notebooks');

const md = (texto) => ({ cell_type: 'markdown', metadata: {}, source: linhas(texto) });
const code = (texto, titulo) => ({
  cell_type: 'code', execution_count: null, outputs: [],
  metadata: titulo ? { cellView: 'form', id: titulo } : {},
  source: linhas(texto),
});
function linhas(texto) {
  const l = texto.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
  return l.map((x, i) => (i < l.length - 1 ? `${x}\n` : x));
}
const notebook = (celulas, colab) => ({
  nbformat: 4, nbformat_minor: 0,
  metadata: { colab: { provenance: [], ...colab }, kernelspec: { name: 'python3', display_name: 'Python 3' }, language_info: { name: 'python' } },
  cells: celulas,
});

// Escreve _colab/status/<servico>.json no Drive: o Painel lê esse arquivo para mostrar o andamento.
const STATUS = `
#@title 2. Drive e status para o Painel
from google.colab import drive
import json, os, time, threading, subprocess, collections
from datetime import datetime

RAIZ = '/content/drive/MyDrive/EditorVideos'
STATUS_DIR = f'{RAIZ}/_colab/status'

# A pasta EditorVideos vem do PC (Drive para computador). Se a montagem do Colab estiver velha ela
# não aparece; remonta e, se ainda faltar, para aqui em vez de criar uma "EditorVideos (1)" vazia.
# Pelo Colab CLI (Painel/colab-cli) o Drive já vem montado por \`colab drivemount\`: drive.mount() aqui
# ficaria esperando um navegador que não existe.
# Tarefas que não precisam do Drive (ex.: a voz pelo CLI) mandam EDITORVIDEOS_SEM_DRIVE=1: o status fica na VM
# e o Painel acompanha pelo log do CLI.
SEM_DRIVE = os.environ.get('EDITORVIDEOS_SEM_DRIVE') == '1'
if SEM_DRIVE:
    STATUS_DIR = '/content/_colab/status'
    print('Sem Drive nesta tarefa: o andamento vai pelo log do Colab CLI.')
elif os.environ.get('EDITORVIDEOS_CLI') and os.path.isdir('/content/drive/MyDrive'):
    print('Drive montado pelo Colab CLI.')
else:
    drive.mount('/content/drive', force_remount=True)
    if not os.path.isdir(f'{RAIZ}/HyperFrames'):
        time.sleep(10)
        drive.flush_and_unmount()
        drive.mount('/content/drive', force_remount=True)
if not SEM_DRIVE and not os.path.isdir(f'{RAIZ}/HyperFrames'):
    raise SystemExit('EditorVideos/HyperFrames não está visível neste Drive. Confira se o Colab está na mesma conta '
                     'do Drive do PC e se a sincronização terminou; depois Ambiente de execução → Desconectar e excluir.')

class Status:
    """Grava o andamento em _colab/status/<servico>.json. Batimento a cada 15 s enquanto roda."""
    def __init__(self, servico, notebook):
        os.makedirs(STATUS_DIR, exist_ok=True)
        self.arq = f'{STATUS_DIR}/{servico}.json'
        self.d = dict(servico=servico, notebook=notebook, estado='rodando', etapa='iniciando',
                      progresso=None, mensagem='', inicio=int(time.time() * 1000))
        self.log = collections.deque(maxlen=40)
        self._trava = threading.Lock()
        self._ultimo = 0
        self._vivo = True
        threading.Thread(target=self._batimento, daemon=True).start()
        self.gravar()

    def _gpu(self):
        try:
            out = subprocess.run(['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total',
                                  '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=5).stdout
            nome, uso, usada, total = [x.strip() for x in out.strip().splitlines()[0].split(',')]
            return dict(nome=nome, uso=int(uso), memoria_usada_mb=int(usada), memoria_total_mb=int(total))
        except Exception:
            return None

    def _ram(self):
        try:
            m = {}
            for linha in open('/proc/meminfo'):
                k, v = linha.split(':')
                m[k] = int(v.split()[0])
            return dict(usada_mb=(m['MemTotal'] - m['MemAvailable']) // 1024, total_mb=m['MemTotal'] // 1024)
        except Exception:
            return None

    def gravar(self):
        with self._trava:
            self.d.update(log=list(self.log), gpu=self._gpu(), ram=self._ram(), atualizado=int(time.time() * 1000))
            tmp = self.arq + '.tmp'
            with open(tmp, 'w') as f:
                json.dump(self.d, f, ensure_ascii=False)
            os.replace(tmp, self.arq)
            self._ultimo = time.time()

    def _batimento(self):
        while self._vivo:
            time.sleep(15)
            if self._vivo:
                self.gravar()

    def __call__(self, etapa=None, progresso=None, mensagem=None, linha=None):
        mudou = etapa is not None and etapa != self.d['etapa']
        if etapa is not None: self.d['etapa'] = etapa
        if progresso is not None: self.d['progresso'] = round(progresso, 1)
        if mensagem is not None: self.d['mensagem'] = mensagem
        if linha:
            self.log.append(f'{datetime.now():%H:%M:%S} {linha}')
            print(linha)
        # Não martela o Drive: no máximo uma gravação a cada 3 s, salvo mudança de etapa.
        if mudou or linha or time.time() - self._ultimo > 3:
            self.gravar()

    def fim(self, estado='concluido', mensagem=''):
        self._vivo = False
        self.d.update(estado=estado, mensagem=mensagem, etapa='fim' if estado == 'concluido' else self.d['etapa'])
        if estado == 'concluido': self.d['progresso'] = 100
        self.gravar()

print('Drive montado. Status em', STATUS_DIR)
`;

const transcrever = notebook([
  md(`
# 1 · Transcrever (Whisper na GPU)

Transcreve os vídeos/áudios de \`EditorVideos/<projeto>/entrada\` e grava em \`EditorVideos/<projeto>/transcricao\`:

- \`<nome>.json\`: palavras com tempo (\`[{text, start, end}]\`), o formato que o HyperFrames importa para legendas palavra a palavra
- \`<nome>.srt\` e \`<nome>.vtt\`: legendas por frase (o FilmCraft importa \`.srt\`)

**Antes:** Ambiente de execução → Alterar tipo → **GPU T4**. Depois: Ambiente de execução → Executar tudo.
O andamento aparece no Painel, aba Colab.
`),
  code(`
#@title 1. Configuração
PROJETO = "HyperFrames"  #@param ["HyperFrames", "FilmCraft"]
ARQUIVO = ""  #@param {type:"string"}
#@markdown Vazio = todos da entrada que ainda não têm transcrição.
IDIOMA = "pt"  #@param {type:"string"}
MODELO = "large-v3-turbo"  #@param ["large-v3-turbo", "large-v3", "medium", "small"]
REFAZER = False  #@param {type:"boolean"}

# Pelo Colab CLI os valores chegam por variável de ambiente (colab exec --env).
import os
PROJETO = os.environ.get('PROJETO', PROJETO)
ARQUIVO = os.environ.get('ARQUIVO', ARQUIVO)
REFAZER = os.environ.get('REFAZER', str(REFAZER)).lower() in ('1', 'true', 'sim')
`, 'config'),
  code(STATUS, 'status'),
  code(`
#@title 3. Instalar o faster-whisper
!pip -q install faster-whisper==1.1.1 nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"

# O ctranslate2 procura o cuBLAS/cuDNN do CUDA 12; o Colab pode vir com outro CUDA. Carrega os do pip
# antes do modelo: o dlopen dele acha as bibliotecas já na memória. Repete porque umas dependem das outras.
import ctypes, glob, site
faltam = [l for d in site.getsitepackages() for pasta in ('cublas', 'cudnn')
          for l in sorted(glob.glob(f'{d}/nvidia/{pasta}/lib/lib*.so*'))]
for _ in range(4):
    pendentes = []
    for l in faltam:
        try:
            ctypes.CDLL(l, mode=ctypes.RTLD_GLOBAL)
        except OSError:
            pendentes.append(l)
    faltam = pendentes
print('CUDA 12 carregado' if not faltam else f'não carregou: {faltam}')
`, 'instalar'),
  code(`
#@title 4. Transcrever
import glob, pathlib
import ctranslate2
from faster_whisper import WhisperModel

BASE = f'{RAIZ}/{PROJETO}'
ENTRADA, SAIDA = f'{BASE}/entrada', f'{BASE}/transcricao'
os.makedirs(SAIDA, exist_ok=True)
EXT = ('.mp4', '.mov', '.mkv', '.webm', '.m4v', '.mp3', '.m4a', '.wav', '.aac', '.ogg', '.opus')

# Decodifica com o ffmpeg do Colab (16 kHz mono): o PyAV novo do Colab quebra o decode do faster-whisper 1.1.1.
import numpy as np
def ler_audio(arq):
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', arq, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0

def tempo(s, sep=','):
    ms = int(round(s * 1000))
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}{sep}{ms % 1000:03}'

if ARQUIVO:
    arquivos = [f'{ENTRADA}/{ARQUIVO}']
else:
    arquivos = [p for p in sorted(glob.glob(f'{ENTRADA}/*')) if p.lower().endswith(EXT)
                and (REFAZER or not os.path.exists(f'{SAIDA}/{pathlib.Path(p).stem}.json'))]

st = Status('transcricao', '1_transcrever')
try:
    if not arquivos:
        st.fim('concluido', f'Nada novo para transcrever em {PROJETO}/entrada')
    else:
        gpu = ctranslate2.get_cuda_device_count() > 0
        st('carregando modelo', 0, f'{MODELO} · {"GPU" if gpu else "CPU (lento!)"}', f'{len(arquivos)} arquivo(s) para transcrever')
        modelo = WhisperModel(MODELO, device='cuda' if gpu else 'cpu', compute_type='float16' if gpu else 'int8')
        for i, arq in enumerate(arquivos):
            nome = pathlib.Path(arq).stem
            st(f'transcrevendo {i + 1}/{len(arquivos)}', i / len(arquivos) * 100, pathlib.Path(arq).name, f'início: {pathlib.Path(arq).name}')
            segs, info = modelo.transcribe(ler_audio(arq), language=IDIOMA or None, word_timestamps=True, vad_filter=True, beam_size=5)
            palavras, frases = [], []
            for s in segs:
                frases.append((s.start, s.end, s.text.strip()))
                palavras += [dict(text=w.word.strip(), start=round(w.start, 3), end=round(w.end, 3)) for w in (s.words or []) if w.word.strip()]
                st(progresso=(i + min(1, s.end / max(info.duration, 1e-6))) / len(arquivos) * 100)
            with open(f'{SAIDA}/{nome}.json', 'w') as f:
                json.dump(palavras, f, ensure_ascii=False, indent=1)
            with open(f'{SAIDA}/{nome}.srt', 'w') as f:
                f.write('\\n'.join(f'{n}\\n{tempo(a)} --> {tempo(b)}\\n{t}\\n' for n, (a, b, t) in enumerate(frases, 1)))
            with open(f'{SAIDA}/{nome}.vtt', 'w') as f:
                f.write('WEBVTT\\n\\n' + '\\n'.join(f'{tempo(a, ".")} --> {tempo(b, ".")}\\n{t}\\n' for a, b, t in frases))
            st(linha=f'ok: {nome} ({len(palavras)} palavras, {info.duration / 60:.1f} min, idioma {info.language})')
        st.fim('concluido', f'{len(arquivos)} arquivo(s) em {PROJETO}/transcricao')
except Exception as e:
    st(linha=f'ERRO: {e}')
    st.fim('erro', str(e))
    raise
`, 'transcrever'),
], { gpuType: 'T4' });
transcrever.metadata.accelerator = 'GPU';

const renderizar = notebook([
  md(`
# 2 · Renderizar (HyperFrames na CPU do Colab)

Renderiza uma composição de \`EditorVideos/HyperFrames/composicoes/<nome>\` e grava o MP4 em \`EditorVideos/HyperFrames/saida\`.
Usa a mesma versão do HyperFrames do PC (0.8.225), sem telemetria. Node é baixado do nodejs.org e conferido por SHA-256.

**Antes:** Ambiente de execução → Alterar tipo → **CPU com RAM alta** (não precisa de GPU). Depois: Executar tudo.
O andamento aparece no Painel, aba Colab.
`),
  code(`
#@title 1. Configuração
COMPOSICAO = ""  #@param {type:"string"}
#@markdown Nome da pasta em HyperFrames/composicoes.
QUALIDADE = "looks"  #@param ["draft", "looks", "delivery"]
WORKERS = 4  #@param {type:"integer"}

# Pelo Colab CLI os valores chegam por variável de ambiente (colab exec --env).
import os
COMPOSICAO = os.environ.get('COMPOSICAO', COMPOSICAO)
QUALIDADE = os.environ.get('QUALIDADE', QUALIDADE)
WORKERS = int(os.environ.get('WORKERS', WORKERS))
`, 'config'),
  code(STATUS, 'status'),
  code(`
#@title 3. Instalar Node 22 + HyperFrames 0.8.225
NODE = 'v22.20.0'
st = Status('render', '2_renderizar')
st('instalando', 2, f'Node {NODE} + hyperframes 0.8.225', 'baixando Node')
!cd /content && curl -fsSLO https://nodejs.org/dist/{NODE}/node-{NODE}-linux-x64.tar.xz && curl -fsSLO https://nodejs.org/dist/{NODE}/SHASUMS256.txt
!cd /content && grep " node-{NODE}-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c - && tar -xJf node-{NODE}-linux-x64.tar.xz
os.environ['PATH'] = f'/content/node-{NODE}-linux-x64/bin:' + os.environ['PATH']
os.environ.update(HYPERFRAMES_NO_TELEMETRY='1', DO_NOT_TRACK='1', HYPERFRAMES_SKIP_SKILLS='1')
# Emoji colorido dos adesivos/legendas: sem esta fonte o Chrome do Colab desenha quadradinhos.
!apt-get -qq install -y fonts-noto-color-emoji > /dev/null

os.makedirs('/content/hf', exist_ok=True)
with open('/content/hf/package.json', 'w') as f:
    json.dump({'private': True, 'dependencies': {'hyperframes': '0.8.225'}, 'overrides': {'undici': '7.30.1'}}, f)
st(linha='npm install hyperframes')
!cd /content/hf && npm install --no-audit --no-fund --loglevel=error
st(linha='baixando o Chrome do render')
!cd /content/hf && node node_modules/hyperframes/bin/hyperframes.mjs telemetry disable; node node_modules/hyperframes/bin/hyperframes.mjs browser ensure
st('instalado', 10, linha='pronto para renderizar')
`, 'instalar'),
  code(`
#@title 4. Renderizar
import re, shutil, pathlib
HF = '/content/hf/node_modules/hyperframes/bin/hyperframes.mjs'
ORIGEM = f'{RAIZ}/HyperFrames/composicoes/{COMPOSICAO}'
SAIDA = f'{RAIZ}/HyperFrames/saida'
try:
    if not COMPOSICAO or not os.path.exists(f'{ORIGEM}/index.html'):
        raise FileNotFoundError(f'Composição não encontrada: {ORIGEM}')
    # Copia para o disco local do Colab: o render lê muito arquivo e o Drive montado é lento.
    local = f'/content/comp/{COMPOSICAO}'
    shutil.rmtree(local, ignore_errors=True)
    shutil.copytree(ORIGEM, local, ignore=shutil.ignore_patterns('.hyperframes', 'renders', 'node_modules'))
    nome = f'{COMPOSICAO}_{time.strftime("%Y%m%d-%H%M")}_colab.mp4'
    st(f'renderizando ({QUALIDADE})', 10, COMPOSICAO, f'render {COMPOSICAO} · {QUALIDADE} · {WORKERS} workers')
    proc = subprocess.Popen(['node', HF, 'render', local, '-o', f'/content/{nome}', '-q', QUALIDADE, '-w', str(WORKERS)],
                            cwd=local, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for linha in proc.stdout:
        linha = re.sub(r'\\x1b\\[[0-9;?]*[A-Za-z]', '', linha).strip()
        if not linha: continue
        pct = re.search(r'(\\d{1,3}(?:\\.\\d+)?)\\s?%', linha)
        if pct and float(pct.group(1)) <= 100:
            st(progresso=10 + float(pct.group(1)) * 0.85)
        else:
            st(linha=linha[:200])
    if proc.wait() != 0:
        raise RuntimeError(f'render saiu com código {proc.returncode}')
    # A CLI pode sair com 0 mesmo com "Render failed" (ex.: mixagem de áudio bloqueada): confere o arquivo.
    if not os.path.exists(f'/content/{nome}'):
        raise RuntimeError('o render não gerou o MP4; veja o log acima')
    st('copiando para o Drive', 96, linha=f'copiando {nome}')
    os.makedirs(SAIDA, exist_ok=True)
    shutil.copy(f'/content/{nome}', f'{SAIDA}/{nome}')
    st.fim('concluido', f'HyperFrames/saida/{nome}')
except Exception as e:
    st(linha=f'ERRO: {e}')
    st.fim('erro', str(e))
    raise
`, 'renderizar'),
], { machine_shape: 'hm' });

const voz = notebook([
  md(`
# 3 · Voz (Chatterbox Multilingual na GPU)

Gera uma narração em português a partir de um texto, com o [Chatterbox](https://github.com/resemble-ai/chatterbox) (licença MIT).
O texto é dividido em frases, cada uma gerada separadamente e unida com uma pausa curta (o modelo corta textos longos).
Grava \`EditorVideos/HyperFrames/voz/<nome>.wav\`.

Voz própria (opcional): ponha uma gravação limpa de 10 a 20 s em \`HyperFrames/voz/referencia\` e escolha o arquivo em VOZ_REF.
**Só a sua voz ou de quem autorizou.**

**Antes:** Ambiente de execução → Alterar tipo → **GPU T4**. Depois: Executar tudo. A instalação leva uns 5 min.
`),
  code(`
#@title 1. Configuração
TEXTO = ""  #@param {type:"string"}
NOME = "narracao"  #@param {type:"string"}
VOZ_REF = ""  #@param {type:"string"}
#@markdown Vazio = voz padrão do modelo. Ou o nome de um arquivo em HyperFrames/voz/referencia.
EXPRESSAO = 0.5  #@param {type:"slider", min:0.25, max:1.5, step:0.05}
#@markdown 0,5 = natural. Mais alto = mais emoção e mais rápido.
RITMO = 0.5  #@param {type:"slider", min:0.0, max:1.0, step:0.05}
#@markdown cfg_weight do modelo. Mais baixo = fala mais pausada.
PAUSA = 0.3  #@param {type:"number"}
SEMENTE = 7  #@param {type:"integer"}

# Pelo Colab CLI os valores chegam por variável de ambiente; o texto vem em base64 (acentos e quebras de linha intactos).
import os, base64
if os.environ.get('TEXTO_B64'): TEXTO = base64.b64decode(os.environ['TEXTO_B64']).decode('utf-8')
NOME = os.environ.get('NOME', NOME)
VOZ_REF = os.environ.get('VOZ_REF', VOZ_REF)
EXPRESSAO = float(os.environ.get('EXPRESSAO', EXPRESSAO))
RITMO = float(os.environ.get('RITMO', RITMO))
`, 'config'),
  code(STATUS, 'status'),
  code(`
#@title 3. Instalar o Chatterbox
st = Status('voz', '3_voz')
import importlib.util
if importlib.util.find_spec('chatterbox') is None:
    st('instalando', 2, 'chatterbox-tts 0.1.7', 'instalando o Chatterbox (uns 4 min)')
    get_ipython().system('pip -q install chatterbox-tts==0.1.7')
    # O chatterbox fixa outra versão do torch; o torchvision do Colab fica incompatível ("torchvision::nms does not
    # exist") e quebra o transformers. A voz não usa torchvision: remover resolve.
    get_ipython().system('pip -q uninstall -y torchvision')
    st('instalado', 15, linha='Chatterbox instalado')
else:
    st('instalado', 15, linha='Chatterbox já instalado nesta sessão')
`, 'instalar'),
  code(`
#@title 4. Gerar a narração
import re, shutil, torch, torchaudio as ta

def frases(texto, limite=260):
    """Divide em frases e junta as curtas até ~limite caracteres; frase longa demais é quebrada nas vírgulas."""
    partes = [p.strip() for p in re.split(r'(?<=[.!?…])\\s+|\\n+', texto) if p.strip()]
    blocos, atual = [], ''
    for p in partes:
        pedacos = [p] if len(p) <= limite else [x.strip() for x in re.split(r'(?<=[,;:])\\s+', p) if x.strip()]
        for x in pedacos:
            if atual and len(atual) + len(x) + 1 > limite:
                blocos.append(atual)
                atual = x
            else:
                atual = f'{atual} {x}'.strip()
    return blocos + ([atual] if atual else [])

VOZ_DIR = f'{RAIZ}/HyperFrames/voz'
# Pelo CLI o .wav fica na VM e o Painel baixa direto (sem esperar o Drive sincronizar); no navegador vai para o Drive.
DESTINO = '/content/voz' if os.environ.get('EDITORVIDEOS_CLI') else VOZ_DIR
try:
    NOME = re.sub(r'[^\\w.-]+', '-', NOME.strip()) or 'narracao'
    blocos = frases(TEXTO)
    if not blocos:
        raise ValueError('TEXTO vazio: escreva o roteiro na configuração.')
    # Pelo CLI a referência chega por upload (VOZ_REF_CAMINHO); no navegador vem do Drive.
    ref = os.environ.get('VOZ_REF_CAMINHO') or (f'{VOZ_DIR}/referencia/{VOZ_REF}' if VOZ_REF else None)
    if ref and not os.path.exists(ref):
        raise FileNotFoundError(f'Voz de referência não encontrada: HyperFrames/voz/referencia/{VOZ_REF}')
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    gpu = torch.cuda.is_available()
    st('carregando modelo', 17, 'GPU' if gpu else 'CPU (muito lento!)', 'carregando o modelo')
    # Sessão mantida ligada pelo Painel: o modelo da rodada anterior continua na memória da GPU.
    if globals().get('modelo') is None:
        modelo = ChatterboxMultilingualTTS.from_pretrained(device='cuda' if gpu else 'cpu')
    torch.manual_seed(SEMENTE)
    pausa = torch.zeros(1, int(modelo.sr * PAUSA))
    partes = []
    for i, b in enumerate(blocos):
        st(f'gerando {i + 1}/{len(blocos)}', 20 + i / len(blocos) * 75, b[:80])
        extra = dict(audio_prompt_path=ref) if ref else {}
        wav = modelo.generate(b, language_id='pt', exaggeration=EXPRESSAO, cfg_weight=RITMO, **extra).cpu()
        partes += [wav, pausa]
    audio = torch.cat(partes[:-1], dim=-1)
    os.makedirs(DESTINO, exist_ok=True)
    ta.save(f'{DESTINO}/{NOME}.wav', audio, modelo.sr)
    seg = audio.shape[-1] / modelo.sr
    st(linha=f'ok: {NOME}.wav ({seg:.1f} s, {len(blocos)} trechos, voz {VOZ_REF or "padrão"})')
    st.fim('concluido', f'HyperFrames/voz/{NOME}.wav · {seg:.0f} s de fala')
except Exception as e:
    st(linha=f'ERRO: {e}')
    st.fim('erro', str(e))
    raise
`, 'gerar'),
], { gpuType: 'T4' });
voz.metadata.accelerator = 'GPU';

// Blender oficial para Linux, conferido pelo SHA-256 publicado em download.blender.org (blender-5.2.2.sha256).
const BLENDER = { versao: '5.2.2', serie: '5.2', sha256: '84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168' };

// Instalação do Blender oficial (usada pelo 4_blender e pela vitrine do 5_3d_ia). Pede `st` (Status) já criado.
const INSTALAR_BLENDER = `
import hashlib, subprocess, urllib.request
PASTA = '/content/blender-${BLENDER.versao}-linux-x64'
BLENDER = f'{PASTA}/blender'
if not os.path.exists(BLENDER):
    st('baixando', 2, 'Blender ${BLENDER.versao}', 'baixando o Blender (uns 380 MB)')
    pacote = '/content/blender.tar.xz'
    urllib.request.urlretrieve('https://download.blender.org/release/Blender${BLENDER.serie}/blender-${BLENDER.versao}-linux-x64.tar.xz', pacote)
    h = hashlib.sha256()
    with open(pacote, 'rb') as f:
        for bloco in iter(lambda: f.read(1 << 20), b''):
            h.update(bloco)
    if h.hexdigest() != '${BLENDER.sha256}':
        raise SystemExit(f'SHA-256 do Blender não confere ({h.hexdigest()}); download interrompido ou adulterado.')
    st('extraindo', 8, linha='SHA-256 conferido')
    subprocess.run(['tar', '-xf', pacote, '-C', '/content'], check=True)
    os.remove(pacote)
    # Bibliotecas de sistema que o Blender pede mesmo sem interface.
    subprocess.run('apt-get -qq install -y libxkbcommon0 libsm6 libxi6 libxxf86vm1 libgl1 > /dev/null', shell=True)
st('instalado', 12, linha=subprocess.run([BLENDER, '--version'], capture_output=True, text=True).stdout.splitlines()[0])
`;

const blender = notebook([
  md(`
# 4 · 3D no Blender (Cycles na GPU)

Roda um script de \`Blender/scripts\` (modelo procedural, cena, luz e câmera) no Blender ${BLENDER.versao} e renderiza com o
Cycles na GPU da VM (OptiX ou CUDA). Sai \`<nome>.png\` (render), \`<nome>.glb\` (para web e HyperFrames) e \`<nome>.blend\`, num .zip.

Pelo Painel (aba Blender → "renderizar no Colab") tudo é automático: o script sobe para a VM e o .zip volta para \`Blender/saida\`.
No navegador: envie o script e o \`_estudio.py\` para \`/content\` (ícone de pasta à esquerda), escreva o nome em SCRIPT e Executar tudo.
`),
  code(`
#@title 1. Configuração
SCRIPT = "microfone.py"  #@param {type:"string"}
NOME = "microfone"  #@param {type:"string"}
PORCENTAGEM = 100  #@param {type:"integer"}
AMOSTRAS = 256  #@param {type:"integer"}

import os
SCRIPT = os.environ.get('SCRIPT', SCRIPT)
NOME = os.environ.get('NOME', NOME)
PORCENTAGEM = int(os.environ.get('PORCENTAGEM', PORCENTAGEM))
AMOSTRAS = int(os.environ.get('AMOSTRAS', AMOSTRAS))
`, 'config'),
  code(STATUS, 'status'),
  code(`
#@title 3. Instalar o Blender (oficial, conferido)
st = Status('blender', '4_blender')
${INSTALAR_BLENDER}
`, 'instalar'),
  code(`
#@title 4. Renderizar
import re, shutil, time
SAIDA = f'/content/blender/saida/{NOME}'
os.makedirs(SAIDA, exist_ok=True)
caminho = SCRIPT if os.path.isabs(SCRIPT) else f'/content/{SCRIPT}'
try:
    if not os.path.exists(caminho):
        raise FileNotFoundError(f'Script não encontrado: {caminho}')
    st('renderizando', 15, SCRIPT, f'{PORCENTAGEM}% · {AMOSTRAS} amostras na GPU')
    t0 = time.time()
    proc = subprocess.Popen([BLENDER, '-b', '--factory-startup', '--offline-mode', '-P', caminho, '--', SAIDA, str(PORCENTAGEM), str(AMOSTRAS)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env={**os.environ, 'EDITORVIDEOS_GPU': '1'})
    ultimo = 0
    for linha in proc.stdout:
        linha = linha.rstrip()
        amostra = re.search(r'Sample (\\d+)/(\\d+)', linha)
        if amostra and time.time() - ultimo > 5:
            ultimo = time.time()
            a, b = int(amostra.group(1)), int(amostra.group(2))
            st(f'amostra {a}/{b}', 15 + a / b * 80)
            print(f'[3d] amostra {a}/{b} ({a / b * 100:.0f}%)', flush=True)
        elif linha.startswith('[3d]') or 'Error' in linha or 'Traceback' in linha:
            st(linha=linha)
    if proc.wait() != 0:
        raise RuntimeError(f'O Blender saiu com código {proc.returncode} (veja o log acima).')
    shutil.make_archive(f'/content/blender/{NOME}', 'zip', SAIDA)
    st(linha=f'ok: {NOME}.zip em {time.time() - t0:.0f} s ({", ".join(sorted(os.listdir(SAIDA)))})')
    st.fim('concluido', f'{NOME}: render em {time.time() - t0:.0f} s')
except Exception as e:
    st(linha=f'ERRO: {e}')
    st.fim('erro', str(e))
    raise
`, 'renderizar'),
], { gpuType: 'T4' });
blender.metadata.accelerator = 'GPU';

// TRELLIS.2 (Microsoft, MIT) com tudo fixo num commit. Rodas do flash-attn oficiais (BSD-3), conferidas pelo SHA-256
// que o GitHub publica. CuMesh, FlexGEMM e o-voxel (MIT) são compilados na primeira vez e guardados pelo Painel.
// Não instala nvdiffrast/nvdiffrec (NVIDIA, só uso não comercial): a textura é assada por textura_aberta.py.
const TRELLIS = {
  commit: '75fbf0183001ed9876c8dbb35de6b68552ee08bd',
  cumesh: '12289e1062f0603f2f0d0771b02e1395d247f26f',
  flexgemm: '6dd94a859c26ee8246888502eada3dd8ad85532e',
  birefnet: 'e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4',
  arch: '8.0;8.6;8.9;9.0',
  flash: {
    cp310: '62b17d5d414380fc6f21e63d23cf1454509e11b83403e7c11e03fe03c3727a4d',
    cp311: '12296a8a0f60118f1a404ad97db6d7d2e6b7e2f2475b47b4618fb8c80e6f9362',
    cp312: 'f4c4425417ae29a745cb53c923dd5894da42881ba8f75d1fef00980930c23765',
    cp313: '9e6fe90c21fc0f2e016748e07eac4cb4743ea60f863d39cb45e37847c6249482',
  },
};

const ia3d = notebook([
  md(`
# 5 · 3D por IA (imagem → modelo com textura, TRELLIS.2)

Transforma uma imagem (objeto ou personagem com fundo simples) num modelo 3D com textura PBR, usando o
[TRELLIS.2](https://github.com/microsoft/TRELLIS.2) (Microsoft, MIT), e renderiza uma vitrine no Blender. Sai \`<nome>.glb\`,
\`<nome>.png\` (vitrine), \`<nome>.blend\`, \`<nome>_entrada.png\` (a imagem já sem fundo) e, com giro, \`<nome>_giro.mp4\`.

- GPU com 24 GB ou mais (L4, A100, H100).
- Precisa de um token do Hugging Face com acesso liberado ao DINOv3 (\`facebook/dinov3-vitl16-pretrain-lvd1689m\`, licença da Meta).
- O fundo é tirado com o BiRefNet (MIT). A textura é assada sem o nvdiffrast (licença NVIDIA não comercial): \`textura_aberta.py\`.
- A primeira vez compila extensões CUDA (demora); o Painel guarda o resultado e manda de volta nas próximas.

Pelo Painel (aba Blender → "gerar 3D no Colab") tudo é automático.
`),
  code(`
#@title 1. Configuração
IMAGEM = "conceito.png"  #@param {type:"string"}
NOME = "modelo"  #@param {type:"string"}
QUALIDADE = "1024_cascade"  #@param ["512", "1024_cascade", "1536_cascade"]
TEXTURA = 2048  #@param {type:"integer"}
FACES = 500000  #@param {type:"integer"}
SEMENTE = 42  #@param {type:"integer"}
AMOSTRAS = 256  #@param {type:"integer"}
GIRO = 0  #@param {type:"integer"}

import os
IMAGEM = os.environ.get('IMAGEM', IMAGEM)
NOME = os.environ.get('NOME', NOME)
QUALIDADE = os.environ.get('QUALIDADE', QUALIDADE)
TEXTURA = int(os.environ.get('TEXTURA', TEXTURA))
FACES = int(os.environ.get('FACES', FACES))
SEMENTE = int(os.environ.get('SEMENTE', SEMENTE))
AMOSTRAS = int(os.environ.get('AMOSTRAS', AMOSTRAS))
GIRO = int(os.environ.get('GIRO', GIRO))
`, 'config'),
  code(STATUS, 'status'),
  code(`
#@title 3. Instalar o TRELLIS.2 (versões fixas, conferidas)
import hashlib, json, subprocess, sys, tarfile, glob, shutil, time, urllib.request
st = Status('ia3d', '5_3d_ia')
t_inicio = time.time()

def sh(cmd, **kw):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        print(r.stdout[-6000:]); print(r.stderr[-6000:])
        raise RuntimeError(f'falhou: {cmd[:160]}')
    return r.stdout

def sha256(caminho):
    h = hashlib.sha256()
    with open(caminho, 'rb') as f:
        for bloco in iter(lambda: f.read(1 << 20), b''):
            h.update(bloco)
    return h.hexdigest()

PY = f'cp{sys.version_info.major}{sys.version_info.minor}'
gpu = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,compute_cap', '--format=csv,noheader,nounits'],
                     capture_output=True, text=True).stdout.strip().split(',')
GPU_NOME, GPU_MB, GPU_CC = gpu[0].strip(), int(gpu[1]), gpu[2].strip()
st('preparando', 1, linha=f'{GPU_NOME} · {GPU_MB} MB · sm {GPU_CC} · Python {PY}')
if GPU_MB < 22000:
    raise SystemExit(f'O TRELLIS.2 precisa de 24 GB de memória de vídeo; esta GPU tem {GPU_MB} MB. Escolha L4, A100 ou H100 no perfil.')
FLASH = ${JSON.stringify(TRELLIS.flash)}
if PY not in FLASH:
    raise SystemExit(f'Python {PY} sem roda pronta do flash-attn; o notebook precisa ser atualizado.')

import importlib.metadata as md
def versao(p):
    try:
        return md.version(p)
    except md.PackageNotFoundError:
        return None

if not (versao('torch') or '').startswith('2.6.0'):
    st('instalando', 3, linha='instalando PyTorch 2.6.0 (CUDA 12.4), a versão do TRELLIS.2')
    sh(f'{sys.executable} -m pip install -q torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124')
if not versao('flash_attn'):
    roda = f'flash_attn-2.8.3.post2+cu12torch2.6cxx11abiFALSE-{PY}-{PY}-linux_x86_64.whl'
    destino = f'/content/{roda}'
    st('instalando', 6, linha='baixando o flash-attn 2.8.3 (roda oficial)')
    urllib.request.urlretrieve(f'https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3.post2/{roda.replace("+", "%2B")}', destino)
    if sha256(destino) != FLASH[PY]:
        raise SystemExit('SHA-256 do flash-attn não confere; download interrompido ou adulterado.')
    sh(f'{sys.executable} -m pip install -q --no-deps {destino}')
    os.remove(destino)
st('instalando', 8, linha='bibliotecas Python do TRELLIS.2')
sh(f'{sys.executable} -m pip install -q easydict plyfile trimesh zstandard opencv-python-headless imageio imageio-ffmpeg '
   f'kornia timm einops ninja "transformers>=4.56" huggingface_hub')

REPO = '/content/TRELLIS.2'
if not os.path.isdir(REPO):
    st('instalando', 10, linha='baixando o código do TRELLIS.2 (commit ${TRELLIS.commit.slice(0, 7)})')
    sh(f'git clone -q https://github.com/microsoft/TRELLIS.2.git {REPO} && cd {REPO} && git checkout -q ${TRELLIS.commit} '
       f'&& git submodule update -q --init --recursive')

# Extensões CUDA: reaproveita as rodas que o Painel guardou (mesmo Python, torch e commits) ou compila e devolve.
EXT = [('cumesh', 'https://github.com/JeffreyXiang/CuMesh.git', '${TRELLIS.cumesh}'),
       ('flex_gemm', 'https://github.com/JeffreyXiang/FlexGEMM.git', '${TRELLIS.flexgemm}'),
       ('o_voxel', None, '${TRELLIS.commit}')]
META = dict(py=PY, torch='2.6.0+cu124', arch='${TRELLIS.arch}', ext={n: c for n, _, c in EXT})
RODAS = '/content/rodas_trellis2'
SAIDA = f'/content/ia3d/{NOME}'
os.makedirs(SAIDA, exist_ok=True)
NOVAS = False
if all(versao(n) for n, _, _ in EXT):
    st(linha='extensões já instaladas nesta máquina')
else:
    usou_cache = False
    if os.path.exists('/content/rodas_trellis2.tar'):
        with tarfile.open('/content/rodas_trellis2.tar') as t:
            t.extractall(RODAS)
        try:
            usou_cache = json.load(open(f'{RODAS}/meta.json')) == META
        except Exception:
            usou_cache = False
        st(linha='rodas guardadas pelo Painel: ' + ('servem, sem compilar' if usou_cache else 'de outra versão, compilando de novo'))
    if not usou_cache:
        shutil.rmtree(RODAS, ignore_errors=True)
        os.makedirs(RODAS)
        amb = {**os.environ, 'TORCH_CUDA_ARCH_LIST': '${TRELLIS.arch}', 'MAX_JOBS': str(os.cpu_count() or 4)}
        for i, (nome, url, commit) in enumerate(EXT):
            pasta = f'{REPO}/o-voxel' if url is None else f'/content/ext/{nome}'
            if url and not os.path.isdir(pasta):
                sh(f'git clone -q {url} {pasta} && cd {pasta} && git checkout -q {commit} && git submodule update -q --init --recursive')
            st('compilando', 12 + i * 8, linha=f'compilando {nome} ({i + 1}/{len(EXT)}); a primeira vez demora')
            t0 = time.time()
            sh(f'{sys.executable} -m pip wheel -q --no-build-isolation --no-deps -w {RODAS} {pasta}', env=amb)
            st(linha=f'{nome} compilado em {time.time() - t0:.0f} s')
        json.dump(META, open(f'{RODAS}/meta.json', 'w'))
        os.makedirs(f'{SAIDA}/_rodas', exist_ok=True)
        with tarfile.open(f'{SAIDA}/_rodas/trellis2-rodas.tar', 'w') as t:
            for arq in os.listdir(RODAS):
                t.add(f'{RODAS}/{arq}', arcname=arq)
        NOVAS = True
    sh(f'{sys.executable} -m pip install -q --no-deps {RODAS}/*.whl')

sys.path.insert(0, REPO)
sys.path.insert(0, '/content')
import textura_aberta
textura_aberta.sem_nvidia()
import torch
# Autoteste do rasterizador UV: dois triângulos cobrindo o quadrado inteiro precisam cobrir todos os texels.
_uv = torch.tensor([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=torch.float32, device='cuda')
_f = torch.tensor([[0, 1, 2], [0, 2, 3]], device='cuda')
_id, _b = textura_aberta.rasterizar_uv(_uv, _f, 64)
assert bool((_id >= 0).all()) and torch.allclose(_b.sum(-1), torch.ones(64, 64, device='cuda')), 'rasterizador UV falhou no autoteste'
st('instalado', 30, linha=f'TRELLIS.2 pronto em {time.time() - t_inicio:.0f} s (torch {torch.__version__})')
`, 'instalar'),
  code(`
#@title 4. Gerar o modelo 3D
import gc
os.environ['ATTN_BACKEND'] = 'flash_attn'
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'
# Token do Hugging Face (só para o DINOv3): o Painel sobe o arquivo, lido aqui e apagado da VM.
if os.path.exists('/content/.hf_token'):
    os.environ['HF_TOKEN'] = open('/content/.hf_token').read().strip()
    os.remove('/content/.hf_token')
if not os.environ.get('HF_TOKEN'):
    raise SystemExit('Falta o token do Hugging Face (aba Blender do Painel → 3D por IA → token).')
from PIL import Image
from huggingface_hub import snapshot_download
from trellis2.pipelines import Trellis2ImageTo3DPipeline
from trellis2.pipelines import rembg as rembg_trellis

# Fundo: BiRefNet original (MIT) num commit fixo, no lugar do RMBG-2.0 (não comercial) do pipeline.json.
BIREFNET = snapshot_download('ZhengPeng7/BiRefNet', revision='${TRELLIS.birefnet}')
class BiRefNetAberto(rembg_trellis.BiRefNet):
    def __init__(self, model_name=None):
        super().__init__(model_name=BIREFNET)
rembg_trellis.BiRefNet = BiRefNetAberto

try:
    t0 = time.time()
    caminho = IMAGEM if os.path.isabs(IMAGEM) else f'/content/{IMAGEM}'
    if not os.path.exists(caminho):
        raise FileNotFoundError(f'Imagem não encontrada: {caminho}')
    st('carregando', 32, linha='carregando os modelos (TRELLIS.2-4B, DINOv3, BiRefNet)')
    try:
        pipeline = Trellis2ImageTo3DPipeline.from_pretrained('microsoft/TRELLIS.2-4B')
    except Exception as e:
        if 'dinov3' in str(e).lower() or '401' in str(e) or '403' in str(e) or 'gated' in str(e).lower():
            raise SystemExit('Sem acesso ao DINOv3: peça em huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m, '
                             'espere a aprovação da Meta e confira o token na aba Blender.') from e
        raise
    pipeline.cuda()
    st('gerando', 40, linha=f'modelos prontos em {time.time() - t0:.0f} s; tirando o fundo')
    entrada = pipeline.preprocess_image(Image.open(caminho))
    entrada.save(f'{SAIDA}/{NOME}_entrada.png')
    st('gerando', 45, linha=f'gerando a forma e a textura ({QUALIDADE}, semente {SEMENTE})')
    t1 = time.time()
    malha = pipeline.run(entrada, seed=SEMENTE, preprocess_image=False, pipeline_type=QUALIDADE)[0]
    st('gerando', 70, linha=f'3D gerado em {time.time() - t1:.0f} s')
    malha.simplify(16777216)
    glb = textura_aberta.to_glb_aberto(
        vertices=malha.vertices, faces=malha.faces, attr_volume=malha.attrs, coords=malha.coords,
        attr_layout=malha.layout, voxel_size=malha.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=FACES, texture_size=TEXTURA, remesh=True, remesh_band=1, remesh_project=0,
        log=lambda l: st(linha=l))
    glb.export(f'{SAIDA}/{NOME}.glb', extension_webp=True)
    st('gerando', 80, linha=f'{NOME}.glb: {os.path.getsize(f"{SAIDA}/{NOME}.glb") / 1e6:.1f} MB · {len(glb.faces)} faces')
    del pipeline, malha, glb
    gc.collect()
    torch.cuda.empty_cache()
except BaseException as e:
    st(linha=f'ERRO: {e}')
    st.fim('erro', str(e))
    raise
`, 'gerar'),
  code(`
#@title 5. Vitrine no Blender e pacote
${INSTALAR_BLENDER}
import re
try:
    st('vitrine', 82, linha=f'vitrine no Blender: {AMOSTRAS} amostras' + (f', giro de {GIRO} quadros' if GIRO else ''))
    proc = subprocess.Popen([BLENDER, '-b', '--factory-startup', '--offline-mode', '-P', '/content/_vitrine.py', '--',
                             f'{SAIDA}/{NOME}.glb', SAIDA, str(AMOSTRAS), str(GIRO)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env={**os.environ, 'EDITORVIDEOS_GPU': '1'})
    for linha in proc.stdout:
        linha = linha.rstrip()
        if linha.startswith('[3d]') or 'Error' in linha or 'Traceback' in linha:
            st(linha=linha)
    if proc.wait() != 0:
        raise RuntimeError(f'O Blender saiu com código {proc.returncode} (veja o log acima).')
    if GIRO and os.path.isdir(f'{SAIDA}/giro'):
        sh(f'ffmpeg -y -loglevel error -framerate 24 -i {SAIDA}/giro/%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 {SAIDA}/{NOME}_giro.mp4')
        shutil.rmtree(f'{SAIDA}/giro')
    shutil.make_archive(f'/content/ia3d/{NOME}', 'zip', SAIDA)
    arquivos = ', '.join(sorted(a for a in os.listdir(SAIDA) if not a.startswith('_')))
    st(linha=f'ok: {NOME}.zip em {time.time() - t_inicio:.0f} s ({arquivos})' + (' + rodas compiladas para as próximas vezes' if NOVAS else ''))
    st.fim('concluido', f'{NOME}: 3D pronto em {time.time() - t_inicio:.0f} s')
except BaseException as e:
    st(linha=f'ERRO: {e}')
    st.fim('erro', str(e))
    raise
`, 'vitrine'),
], { gpuType: 'L4' });
ia3d.metadata.accelerator = 'GPU';

await writeFile(path.join(AQUI, '1_transcrever.ipynb'), JSON.stringify(transcrever, null, 1));
await writeFile(path.join(AQUI, '2_renderizar.ipynb'), JSON.stringify(renderizar, null, 1));
await writeFile(path.join(AQUI, '3_voz.ipynb'), JSON.stringify(voz, null, 1));
await writeFile(path.join(AQUI, '4_blender.ipynb'), JSON.stringify(blender, null, 1));
await writeFile(path.join(AQUI, '5_3d_ia.ipynb'), JSON.stringify(ia3d, null, 1));
console.log('notebooks gerados em', AQUI);
if (existsSync(path.parse(DRIVE).root)) {
  await mkdir(DRIVE, { recursive: true });
  for (const n of ['1_transcrever.ipynb', '2_renderizar.ipynb', '3_voz.ipynb', '4_blender.ipynb', '5_3d_ia.ipynb']) await copyFile(path.join(AQUI, n), path.join(DRIVE, n));
  console.log('copiados para', DRIVE);
} else {
  console.log(`Drive não encontrado (${DRIVE}): copie a pasta notebooks para EditorVideos/_colab/notebooks.`);
}
