#!/usr/bin/env bash
set -euo pipefail

# VaultDeck installer
# Usage:
#   bash install-vaultdeck.sh [--repo <git-url>] [--dir <install-dir>] [--install-hook] [--force]

REPO_URL=""
INSTALL_DIR="${HOME}/Projects/VaultDeck"
VAULT_DIR="${HOME}/.vaultdeck"
INSTALL_HOOK=0
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --install-hook)
      INSTALL_HOOK=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      cat <<'HELP'
VaultDeck installer

Options:
  --repo <git-url>    Clone from this repo URL (if --dir does not exist)
  --dir <path>        Install directory (default: ~/Projects/VaultDeck)
  --install-hook      Add shell source line to ~/.zshrc or ~/.bashrc
  --force             Continue even if target dir exists and is non-empty

Examples:
  bash install-vaultdeck.sh --repo https://github.com/yourname/vaultdeck.git
  bash install-vaultdeck.sh --repo https://github.com/yourname/vaultdeck.git --install-hook
HELP
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd mkdir
need_cmd grep
need_cmd awk
need_cmd sed
need_cmd uname

if [[ ! -d "$INSTALL_DIR" ]]; then
  mkdir -p "$(dirname "$INSTALL_DIR")"
fi

if [[ -d "$INSTALL_DIR/.git" || -f "$INSTALL_DIR/package.json" ]]; then
  echo "Using existing project at: $INSTALL_DIR"
else
  if [[ -n "$REPO_URL" ]]; then
    need_cmd git
    if [[ -d "$INSTALL_DIR" ]] && [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]] && [[ "$FORCE" != "1" ]]; then
      echo "Install dir exists and is non-empty: $INSTALL_DIR"
      echo "Use --force to continue." >&2
      exit 1
    fi
    rm -rf "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
  else
    echo "No repo provided and install dir does not contain VaultDeck."
    echo "Run with --repo <git-url> or place this script inside the VaultDeck project." >&2
    exit 1
  fi
fi

need_cmd node
need_cmd npm

cd "$INSTALL_DIR"
echo "Installing npm dependencies..."
npm install

echo "Ensuring vault structure in: $VAULT_DIR"
mkdir -p "$VAULT_DIR"/{entries,files,projects,meta,backups}
: > "$VAULT_DIR/.env.generated"
: > "$VAULT_DIR/.env.exports.sh"
[[ -f "$VAULT_DIR/meta/env-generation.json" ]] || echo '{}' > "$VAULT_DIR/meta/env-generation.json"

if [[ -x "$INSTALL_DIR/bin/vaultdeck" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$INSTALL_DIR/bin/vaultdeck" "$HOME/.local/bin/vaultdeck"
  echo "Linked CLI: $HOME/.local/bin/vaultdeck"
fi

PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if [[ -f "$rc" ]]; then
    if ! grep -Eq '(^|[[:space:]])export[[:space:]]+PATH="\$HOME/\.local/bin:\$PATH"' "$rc"; then
      echo "$PATH_LINE" >> "$rc"
      echo "Added ~/.local/bin PATH to $rc"
    fi
  fi
done

SOURCE_LINE='[ -f "$HOME/.vaultdeck/.env.exports.sh" ] && source "$HOME/.vaultdeck/.env.exports.sh"'
if [[ "$INSTALL_HOOK" == "1" ]]; then
  if [[ -f "$HOME/.zshrc" ]]; then
    grep -Fq "$SOURCE_LINE" "$HOME/.zshrc" || echo "$SOURCE_LINE" >> "$HOME/.zshrc"
    echo "Added VaultDeck hook to ~/.zshrc"
  elif [[ -f "$HOME/.bashrc" ]]; then
    grep -Fq "$SOURCE_LINE" "$HOME/.bashrc" || echo "$SOURCE_LINE" >> "$HOME/.bashrc"
    echo "Added VaultDeck hook to ~/.bashrc"
  else
    echo "No ~/.zshrc or ~/.bashrc found. Add this manually:"
    echo "$SOURCE_LINE"
  fi
else
  echo "Shell hook not auto-installed (safe default)."
  echo "If desired, add manually:"
  echo "$SOURCE_LINE"
fi

if [[ -x "$INSTALL_DIR/bin/vaultdeck" ]]; then
  "$INSTALL_DIR/bin/vaultdeck" regen || true
fi

cat <<DONE

VaultDeck install complete.

Next:
  cd "$INSTALL_DIR"
  npm run dev

CLI:
  vaultdeck status
  vaultdeck regen
  eval "$(vaultdeck apply --regen)"

If 'vaultdeck' is not found yet, open a new shell or run:
  export PATH="$HOME/.local/bin:$PATH"

DONE
