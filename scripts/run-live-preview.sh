#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pnpm --filter @linkmetry/web build
cargo build -p linkmetry-cli
mkdir -p .linkmetry-data

cat <<MSG
Linkmetry live preview
- URL: http://localhost:9000/
- Data: .linkmetry-data/app-data.json
- Stop: Ctrl+C
MSG

LINKMETRY_DATA_DIR="${LINKMETRY_DATA_DIR:-$PWD/.linkmetry-data}" pnpm --filter @linkmetry/web serve:live
