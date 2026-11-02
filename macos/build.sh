#!/usr/bin/env bash
# Builds dist/Goalify.app (run from anywhere on macOS).
set -euo pipefail
cd "$(dirname "$0")/.."

uv sync --group build
uv run --group build pyinstaller \
  --noconfirm --clean --windowed --paths . --specpath build \
  --name Goalify \
  --osx-bundle-identifier com.goalify.app \
  --add-data "$PWD/goalify/templates:goalify/templates" \
  --add-data "$PWD/goalify/static:goalify/static" \
  macos/launcher.py

echo "Built dist/Goalify.app"
