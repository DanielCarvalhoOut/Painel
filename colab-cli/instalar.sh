#!/usr/bin/env bash
# Instala o Colab CLI oficial (googlecolab/google-colab-cli) dentro desta pasta, pelo WSL (Ubuntu).
# O CLI não roda no Windows nativo. Não precisa de sudo: usa o uv standalone, conferido por SHA-256.
# Rodar no Windows, na pasta do Painel:  wsl -d Ubuntu -- bash colab-cli/instalar.sh
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
UV_VERSAO=0.13.1
CLI_VERSAO=0.7.5
CLI_SHA256=2b303ed21ebd6da829f80d506224a6cd4f0e62d506fb373166d06a0532e516a9   # wheel no PyPI (publicação assinada)

# O venv fica no disco do Linux (symlinks e muitos arquivos pequenos são lentos/instáveis no /mnt/d);
# o uv, os downloads conferidos e a configuração ficam aqui na pasta da ferramenta.
VENV="$HOME/.editorvideos/colab-cli"
mkdir -p "$AQUI/bin" "$AQUI/_dl"
cd "$AQUI/_dl"

if [ ! -x "$AQUI/bin/uv" ] || [ "$("$AQUI/bin/uv" --version | cut -d' ' -f2)" != "$UV_VERSAO" ]; then
  F=uv-x86_64-unknown-linux-gnu.tar.gz
  curl -fsSLO "https://github.com/astral-sh/uv/releases/download/$UV_VERSAO/$F"
  curl -fsSLO "https://github.com/astral-sh/uv/releases/download/$UV_VERSAO/$F.sha256"
  sha256sum -c "$F.sha256"
  tar -xzf "$F"
  cp uv-x86_64-unknown-linux-gnu/uv "$AQUI/bin/uv"
  chmod +x "$AQUI/bin/uv"
fi
"$AQUI/bin/uv" --version

W=google_colab_cli-$CLI_VERSAO-py3-none-any.whl
curl -fsSL -o "$W" "https://files.pythonhosted.org/packages/py3/g/google-colab-cli/$W"
echo "$CLI_SHA256  $W" | sha256sum -c -

export UV_NO_PROGRESS=1
"$AQUI/bin/uv" venv --quiet --allow-existing --python /usr/bin/python3 "$VENV"
VIRTUAL_ENV="$VENV" "$AQUI/bin/uv" pip install --quiet "./$W"
printf '#!/usr/bin/env bash\nexec "%s/bin/colab" "$@"\n' "$VENV" > "$AQUI/bin/colab"
chmod +x "$AQUI/bin/colab"
"$AQUI/bin/colab" --help | head -5
echo "ok: colab $CLI_VERSAO em $VENV (atalho em $AQUI/bin/colab)"
