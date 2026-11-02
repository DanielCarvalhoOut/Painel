#!/usr/bin/env bash
# Roda um notebook do Painel no Colab pelo Colab CLI, sem abrir o navegador:
# cria a sessão, monta o Drive, executa o notebook e sempre desliga a VM no fim (para não gastar unidades).
#
#   rodar.sh transcrever [ARQUIVO]                 GPU T4  · notebooks/1_transcrever.ipynb
#   rodar.sh renderizar  COMPOSICAO [QUALIDADE]    CPU com RAM alta · notebooks/2_renderizar.ipynb
#   rodar.sh voz NOME TEXTO_BASE64 [VOZ_REF]       GPU T4 · notebooks/3_voz.ipynb (baixa o .wav para colab-cli/_voz)
#   rodar.sh login                                 login do CLI (uma vez; o código vem pela entrada)
#   rodar.sh parar                                 desliga as VMs deste script (se um cancelamento deixou ligada)
#
# O andamento continua indo para EditorVideos/_colab/status no Drive (o Painel mostra na aba Colab).
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
COLAB="$AQUI/bin/colab"
NOTEBOOKS="$(cd "$AQUI/../notebooks" && pwd)"
[ -x "$COLAB" ] || { echo "Colab CLI não instalado: rode colab-cli/instalar.sh"; exit 1; }
# login: o CLI mostra o link do Google e lê o código da entrada (o Painel tem um campo para colar).
if [ "${1:-}" = login ]; then "$COLAB" usage; echo "[rodar] login feito"; exit 0; fi
# Sem token, as outras tarefas parariam esperando o código no meio; melhor falhar já (o Painel oferece o login).
[ -f "$HOME/.config/colab-cli/token.json" ] || { echo "Falta o login do Colab CLI: clique em \"fazer login\" na aba Colab do Painel (ou rode colab-cli\\login.cmd)."; exit 3; }

TAREFA="${1:-}"
if [ "$TAREFA" = parar ]; then
  for s in editorvideos-transcrever editorvideos-renderizar editorvideos-voz; do "$COLAB" stop -s "$s" 2>/dev/null && echo "[rodar] $s desligada" || true; done
  exit 0
fi
ENVS=(--env EDITORVIDEOS_CLI=1)
case "$TAREFA" in
  transcrever)
    NB="$NOTEBOOKS/1_transcrever.ipynb"; MAQUINA=(--gpu T4)
    [ -n "${2:-}" ] && ENVS+=(--env "ARQUIVO=$2")
    ;;
  renderizar)
    [ -n "${2:-}" ] || { echo "uso: rodar.sh renderizar COMPOSICAO [draft|looks|delivery]"; exit 2; }
    NB="$NOTEBOOKS/2_renderizar.ipynb"; MAQUINA=(--high-mem)
    ENVS+=(--env "COMPOSICAO=$2" --env "QUALIDADE=${3:-looks}")
    ;;
  voz)
    # O texto vem em base64 (acentos e quebras de linha passam intactos pelo WSL e pelo --env).
    [[ "${2:-}" =~ ^[A-Za-z0-9_.-]+$ ]] && [ -n "${3:-}" ] || { echo "uso: rodar.sh voz NOME TEXTO_BASE64 [VOZ_REF] [EXPRESSAO] [RITMO]"; exit 2; }
    NB="$NOTEBOOKS/3_voz.ipynb"; MAQUINA=(--gpu T4)
    ENVS+=(--env "NOME=$2" --env "TEXTO_B64=$3" --env "VOZ_REF=${4:-}")
    [ -n "${5:-}" ] && ENVS+=(--env "EXPRESSAO=$5")
    [ -n "${6:-}" ] && ENVS+=(--env "RITMO=$6")
    # O .wav fica na VM; baixa para colab-cli/_voz antes de desligar (o Painel copia para HyperFrames/voz).
    BAIXAR="/content/voz/$2.wav"; LOCAL="$AQUI/_voz/$2.wav"
    ;;
  *) echo "uso: rodar.sh transcrever [ARQUIVO] | renderizar COMPOSICAO [QUALIDADE] | voz NOME TEXTO_BASE64 [VOZ_REF]"; exit 2 ;;
esac

SESSAO="editorvideos-$TAREFA"
desligar() { echo "[rodar] desligando a sessão $SESSAO"; "$COLAB" stop -s "$SESSAO" >/dev/null 2>&1 || true; }
trap desligar EXIT

echo "[rodar] criando sessão $SESSAO (${MAQUINA[*]})"
"$COLAB" new -s "$SESSAO" "${MAQUINA[@]}"
echo "[rodar] montando o Google Drive"
if [ -t 0 ]; then
  "$COLAB" drivemount -s "$SESSAO"
else
  # Pelo Painel: o WSL dá um /dev/tty mesmo sem terminal, e o CLI esperaria o Enter ali, onde ninguém digita.
  # Sem terminal de controle (setsid) ele lê da entrada, que o botão "Já autorizei" do Painel alimenta.
  setsid -w "$COLAB" drivemount -s "$SESSAO"
fi
echo "[rodar] executando $(basename "$NB")"
"$COLAB" exec -s "$SESSAO" -f "$NB" --timeout 7200 "${ENVS[@]}"
if [ -n "${BAIXAR:-}" ]; then
  mkdir -p "$(dirname "$LOCAL")"
  echo "[rodar] baixando $(basename "$BAIXAR")"
  "$COLAB" download -s "$SESSAO" "$BAIXAR" "$LOCAL"
  # O exec sai com 0 mesmo se a célula deu erro; sem o arquivo, a tarefa falhou.
  [ -s "$LOCAL" ] || { echo "[rodar] ERRO: a voz não foi gerada (veja o log acima)"; exit 4; }
fi
echo "[rodar] concluído"
