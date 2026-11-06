#!/usr/bin/env bash
# Roda um notebook do Painel no Colab pelo Colab CLI, sem abrir o navegador: liga (ou reaproveita) a VM,
# monta o Drive se a tarefa precisar, executa o notebook e desliga a VM no fim (para não gastar unidades),
# a menos que o Painel peça para mantê-la ligada (--manter); aí quem desliga é o cronômetro do Painel.
#
#   rodar.sh [opções] transcrever [ARQUIVO]
#   rodar.sh [opções] renderizar  COMPOSICAO [QUALIDADE]
#   rodar.sh [opções] voz NOME TEXTO_BASE64 [VOZ_REF] [EXPRESSAO] [RITMO]
#   rodar.sh [opções] blender NOME CAMINHO_DO_SCRIPT [PORCENTAGEM] [AMOSTRAS]
#   rodar.sh [opções] ia3d NOME IMAGEM [QUALIDADE] [TEXTURA] [FACES] [AMOSTRAS] [GIRO] [SEMENTE]
#   rodar.sh login                 login do CLI (o código vem pela entrada)
#   rodar.sh parar [SESSAO]        desliga uma sessão do Painel, ou todas (editorvideos-*)
#   rodar.sh sessoes               lista as sessões ligadas: "nome | hardware"
#   rodar.sh saldo                 saldo de unidades de computação
#
# Opções: --maquina CPU|T4|L4|G4|A100|H100   --ram-alta   --manter   --limite SEGUNDOS
# O andamento continua indo para EditorVideos/_colab/status no Drive (quando a tarefa usa o Drive).
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
COLAB="$AQUI/bin/colab"
NOTEBOOKS="$(cd "$AQUI/../notebooks" && pwd)"
ESTADO="$HOME/.editorvideos/sessoes"   # marca "Drive já montado" por sessão
[ -x "$COLAB" ] || { echo "Colab CLI não instalado: rode colab-cli/instalar.sh"; exit 1; }

saldo() { "$COLAB" usage 2>/dev/null | sed -n 's/^Current balance: \([0-9.]*\).*/\1/p'; }
sessoes() { "$COLAB" sessions 2>/dev/null | sed -n 's/^\[\(editorvideos-[^]]*\)\].*Hardware: \([^|]*\).*/\1 | \2/p'; }

case "${1:-}" in
  # login: o CLI mostra o link do Google e lê o código da entrada (o Painel tem um campo para colar).
  login) "$COLAB" usage; echo "[rodar] login feito"; exit 0 ;;
esac
# Sem token, as outras tarefas parariam esperando o código no meio; melhor falhar já (o Painel oferece o login).
[ -f "$HOME/.config/colab-cli/token.json" ] || { echo "Falta o login do Colab CLI: clique em \"fazer login\" na aba Colab do Painel (ou rode colab-cli\\login.cmd)."; exit 3; }

case "${1:-}" in
  saldo) echo "[rodar] saldo: $(saldo)"; exit 0 ;;
  sessoes) sessoes; exit 0 ;;
  parar)
    if [ -n "${2:-}" ]; then ALVOS="$2"; else ALVOS="$(sessoes | cut -d' ' -f1) editorvideos-transcrever editorvideos-renderizar editorvideos-voz"; fi
    for s in $ALVOS; do
      [[ "$s" =~ ^editorvideos-[a-z0-9-]+$ ]] || continue
      "$COLAB" stop -s "$s" >/dev/null 2>&1 && echo "[rodar] $s desligada" || true
      rm -f "$ESTADO/$s.drive"
    done
    exit 0 ;;
esac

MAQUINA=T4; RAM_ALTA=0; MANTER=0; LIMITE=7200
while [ $# -gt 0 ]; do
  case "$1" in
    --maquina) MAQUINA="$2"; shift 2 ;;
    --ram-alta) RAM_ALTA=1; shift ;;
    --manter) MANTER=1; shift ;;
    --limite) LIMITE="$2"; shift 2 ;;
    --*) echo "opção desconhecida: $1"; exit 2 ;;
    *) break ;;
  esac
done
[[ "$MAQUINA" =~ ^(CPU|T4|L4|G4|A100|H100)$ ]] || { echo "máquina inválida: $MAQUINA"; exit 2; }
[[ "$LIMITE" =~ ^[0-9]+$ ]] || { echo "limite inválido: $LIMITE"; exit 2; }

TAREFA="${1:-}"
ENVS=(--env EDITORVIDEOS_CLI=1)
DRIVE=1
SUBIR=()   # pares: arquivo local, caminho na VM
case "$TAREFA" in
  transcrever)
    NB="$NOTEBOOKS/1_transcrever.ipynb"
    [ -n "${2:-}" ] && ENVS+=(--env "ARQUIVO=$2")
    ;;
  renderizar)
    [ -n "${2:-}" ] || { echo "uso: rodar.sh renderizar COMPOSICAO [draft|looks|delivery]"; exit 2; }
    NB="$NOTEBOOKS/2_renderizar.ipynb"
    ENVS+=(--env "COMPOSICAO=$2" --env "QUALIDADE=${3:-looks}")
    ;;
  voz)
    # O texto vem em base64 (acentos e quebras de linha passam intactos pelo WSL e pelo --env).
    [[ "${2:-}" =~ ^[A-Za-z0-9_.-]+$ ]] && [ -n "${3:-}" ] || { echo "uso: rodar.sh voz NOME TEXTO_BASE64 [VOZ_REF] [EXPRESSAO] [RITMO]"; exit 2; }
    NB="$NOTEBOOKS/3_voz.ipynb"
    # A voz não precisa do Drive: o texto vai por variável, a referência por upload e o .wav volta por download.
    # Assim não aparece o pedido de autorização do Drive.
    DRIVE=0
    ENVS+=(--env EDITORVIDEOS_SEM_DRIVE=1 --env "NOME=$2" --env "TEXTO_B64=$3")
    if [ -n "${4:-}" ]; then
      [[ "$4" =~ ^[A-Za-z0-9_.\ -]+$ ]] && [ -f "$AQUI/_voz/ref/$4" ] || { echo "voz de referência não encontrada: $4"; exit 2; }
      SUBIR+=("$AQUI/_voz/ref/$4" "/content/ref_$4")
      ENVS+=(--env "VOZ_REF=$4" --env "VOZ_REF_CAMINHO=/content/ref_$4")
    fi
    [ -n "${5:-}" ] && ENVS+=(--env "EXPRESSAO=$5")
    [ -n "${6:-}" ] && ENVS+=(--env "RITMO=$6")
    BAIXAR="/content/voz/$2.wav"; LOCAL="$AQUI/_voz/$2.wav"
    ;;
  blender)
    # Script do Blender (Blender/scripts/*.py, com o _estudio.py ao lado) renderizado no Cycles da VM; os dois vão para /content.
    # Sem Drive: os scripts sobem por upload e o resultado volta num .zip por download.
    [[ "${2:-}" =~ ^[A-Za-z0-9_.-]+$ ]] && [ -f "${3:-}" ] || { echo "uso: rodar.sh blender NOME CAMINHO_DO_SCRIPT [PORCENTAGEM] [AMOSTRAS]"; exit 2; }
    NB="$NOTEBOOKS/4_blender.ipynb"
    DRIVE=0
    ENVS+=(--env EDITORVIDEOS_SEM_DRIVE=1 --env "NOME=$2" --env "SCRIPT=$(basename "$3")" --env "PORCENTAGEM=${4:-100}" --env "AMOSTRAS=${5:-256}")
    SUBIR+=("$3" "/content/$(basename "$3")")
    [ -f "$(dirname "$3")/_estudio.py" ] && SUBIR+=("$(dirname "$3")/_estudio.py" "/content/_estudio.py")
    BAIXAR="/content/blender/$2.zip"; LOCAL="$AQUI/_blender/$2.zip"
    ;;
  ia3d)
    # Imagem → modelo 3D com o TRELLIS.2 e vitrine no Blender. Sem Drive: tudo sobe por upload e volta num .zip.
    # O token do Hugging Face (só para o DINOv3) vai como arquivo, nunca na linha de comando nem no log.
    [[ "${2:-}" =~ ^[A-Za-z0-9_.-]+$ ]] && [ -f "${3:-}" ] || { echo "uso: rodar.sh ia3d NOME IMAGEM [QUALIDADE] [TEXTURA] [FACES] [AMOSTRAS] [GIRO] [SEMENTE]"; exit 2; }
    [ -s "$AQUI/_segredos/hf_token" ] || { echo "Falta o token do Hugging Face: aba Blender do Painel → 3D por IA → token."; exit 3; }
    # _vitrine.py e _estudio.py vêm no repo do Painel (pasta blender/); uma cópia editada em Blender/scripts tem prioridade.
    BLENDER_SCRIPTS="$(cd "$AQUI/../../Blender/scripts" 2>/dev/null && pwd || true)"
    [ -f "$BLENDER_SCRIPTS/_vitrine.py" ] && [ -f "$BLENDER_SCRIPTS/_estudio.py" ] || BLENDER_SCRIPTS="$(cd "$AQUI/../blender" && pwd)"
    [ -f "$BLENDER_SCRIPTS/_vitrine.py" ] || { echo "blender/_vitrine.py não encontrado"; exit 2; }
    NB="$NOTEBOOKS/5_3d_ia.ipynb"
    DRIVE=0
    EXT="${3##*.}"
    ENVS+=(--env EDITORVIDEOS_SEM_DRIVE=1 --env "NOME=$2" --env "IMAGEM=/content/entrada_$2.$EXT"
           --env "QUALIDADE=${4:-1024_cascade}" --env "TEXTURA=${5:-2048}" --env "FACES=${6:-500000}"
           --env "AMOSTRAS=${7:-256}" --env "GIRO=${8:-0}" --env "SEMENTE=${9:-42}")
    SUBIR+=("$3" "/content/entrada_$2.$EXT"
            "$AQUI/ia3d/textura_aberta.py" "/content/textura_aberta.py"
            "$BLENDER_SCRIPTS/_vitrine.py" "/content/_vitrine.py"
            "$BLENDER_SCRIPTS/_estudio.py" "/content/_estudio.py"
            "$AQUI/_segredos/hf_token" "/content/.hf_token")
    # Rodas compiladas numa rodada anterior: poupa a compilação (o notebook confere se servem).
    [ -f "$AQUI/_rodas/trellis2-rodas.tar" ] && SUBIR+=("$AQUI/_rodas/trellis2-rodas.tar" "/content/rodas_trellis2.tar")
    BAIXAR="/content/ia3d/$2.zip"; LOCAL="$AQUI/_ia3d/$2.zip"
    ;;
  *) echo "uso: rodar.sh [opções] transcrever [ARQUIVO] | renderizar COMPOSICAO [QUALIDADE] | voz NOME TEXTO_BASE64 [VOZ_REF]"; exit 2 ;;
esac

# Uma sessão por tipo de máquina: tarefas seguidas na mesma máquina reaproveitam a VM mantida ligada.
SESSAO="editorvideos-$(echo "$MAQUINA" | tr '[:upper:]' '[:lower:]')$([ "$RAM_ALTA" = 1 ] && echo -hm || true)"
NOVA=(); [ "$MAQUINA" != CPU ] && NOVA+=(--gpu "$MAQUINA"); [ "$RAM_ALTA" = 1 ] && NOVA+=(--high-mem)
mkdir -p "$ESTADO"

OK=0
fim() {
  if [ "$OK" = 1 ] && [ "$MANTER" = 1 ]; then
    echo "[rodar] sessão $SESSAO mantida ligada"
  else
    echo "[rodar] desligando a sessão $SESSAO"
    "$COLAB" stop -s "$SESSAO" >/dev/null 2>&1 || true
    rm -f "$ESTADO/$SESSAO.drive"
  fi
  echo "[rodar] saldo depois: $(saldo)"
}
echo "[rodar] saldo antes: $(saldo)"
trap fim EXIT

if sessoes | grep -q "^$SESSAO |"; then
  echo "[rodar] reaproveitando a sessão $SESSAO"
else
  echo "[rodar] criando sessão $SESSAO (${NOVA[*]:-CPU})"
  rm -f "$ESTADO/$SESSAO.drive"
  "$COLAB" new -s "$SESSAO" "${NOVA[@]}"
fi
echo "[rodar] máquina: $SESSAO"

if [ "$DRIVE" = 1 ] && [ ! -f "$ESTADO/$SESSAO.drive" ]; then
  echo "[rodar] montando o Google Drive"
  if [ -t 0 ]; then
    "$COLAB" drivemount -s "$SESSAO"
  else
    # Pelo Painel: o WSL dá um /dev/tty mesmo sem terminal, e o CLI esperaria o Enter ali, onde ninguém digita.
    # Sem terminal de controle (setsid) ele lê da entrada, que o botão "Já autorizei" do Painel alimenta.
    setsid -w "$COLAB" drivemount -s "$SESSAO"
  fi
  touch "$ESTADO/$SESSAO.drive"
fi
for ((i = 0; i < ${#SUBIR[@]}; i += 2)); do
  echo "[rodar] enviando $(basename "${SUBIR[i]}")"
  "$COLAB" upload -s "$SESSAO" "${SUBIR[i]}" "${SUBIR[i+1]}"
done

echo "[rodar] executando $(basename "$NB") (limite ${LIMITE}s)"
"$COLAB" exec -s "$SESSAO" -f "$NB" --timeout "$LIMITE" "${ENVS[@]}"
if [ -n "${BAIXAR:-}" ]; then
  mkdir -p "$(dirname "$LOCAL")"
  echo "[rodar] baixando $(basename "$BAIXAR")"
  "$COLAB" download -s "$SESSAO" "$BAIXAR" "$LOCAL"
  # O exec sai com 0 mesmo se a célula deu erro; sem o arquivo, a tarefa falhou.
  [ -s "$LOCAL" ] || { echo "[rodar] ERRO: o resultado não foi gerado (veja o log acima)"; exit 4; }
fi
OK=1
echo "[rodar] concluído"
