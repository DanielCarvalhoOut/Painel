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
if os.environ.get('EDITORVIDEOS_CLI') and os.path.isdir('/content/drive/MyDrive'):
    print('Drive montado pelo Colab CLI.')
else:
    drive.mount('/content/drive', force_remount=True)
    if not os.path.isdir(f'{RAIZ}/HyperFrames'):
        time.sleep(10)
        drive.flush_and_unmount()
        drive.mount('/content/drive', force_remount=True)
if not os.path.isdir(f'{RAIZ}/HyperFrames'):
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
st('instalando', 2, 'chatterbox-tts 0.1.7', 'instalando o Chatterbox (uns 4 min)')
!pip -q install chatterbox-tts==0.1.7
# O chatterbox fixa outra versão do torch; o torchvision do Colab fica incompatível ("torchvision::nms does not
# exist") e quebra o transformers. A voz não usa torchvision: remover resolve.
!pip -q uninstall -y torchvision
st('instalado', 15, linha='Chatterbox instalado')
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
    ref = f'{VOZ_DIR}/referencia/{VOZ_REF}' if VOZ_REF else None
    if ref and not os.path.exists(ref):
        raise FileNotFoundError(f'Voz de referência não encontrada: HyperFrames/voz/referencia/{VOZ_REF}')
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    gpu = torch.cuda.is_available()
    st('carregando modelo', 17, 'GPU' if gpu else 'CPU (muito lento!)', 'carregando o modelo')
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

await writeFile(path.join(AQUI, '1_transcrever.ipynb'), JSON.stringify(transcrever, null, 1));
await writeFile(path.join(AQUI, '2_renderizar.ipynb'), JSON.stringify(renderizar, null, 1));
await writeFile(path.join(AQUI, '3_voz.ipynb'), JSON.stringify(voz, null, 1));
console.log('notebooks gerados em', AQUI);
if (existsSync(path.parse(DRIVE).root)) {
  await mkdir(DRIVE, { recursive: true });
  for (const n of ['1_transcrever.ipynb', '2_renderizar.ipynb', '3_voz.ipynb']) await copyFile(path.join(AQUI, n), path.join(DRIVE, n));
  console.log('copiados para', DRIVE);
} else {
  console.log(`Drive não encontrado (${DRIVE}): copie a pasta notebooks para EditorVideos/_colab/notebooks.`);
}
