#!/bin/bash
set -euo pipefail

SCHEMA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA_FILE="$SCHEMA_DIR/netxray-ir.schema.json"

echo "=== NetXray Type Generation ==="
echo "Schema: $SCHEMA_FILE"

# TypeScript (quicktype)
TS_OUT="$SCHEMA_DIR/../frontend/src/types/netxray-ir.generated.ts"
if command -v quicktype &> /dev/null; then
  echo "Generating TypeScript types..."
  quicktype --src-lang schema --lang ts --src "$SCHEMA_FILE" -o "$TS_OUT" --just-types
  echo "  -> $TS_OUT"
else
  echo "SKIP: quicktype not found. Install with: npm install -g quicktype"
fi

# Rust (typify) — Phase 2
RUST_OUT="$SCHEMA_DIR/../engine/src/types_generated.rs"
if command -v cargo-typify &> /dev/null; then
  echo "Generating Rust types..."
  cargo typify "$SCHEMA_FILE" -o "$RUST_OUT"
  echo "  -> $RUST_OUT"
else
  echo "SKIP: cargo-typify not found. Install with: cargo install cargo-typify"
fi

echo "=== Done ==="
