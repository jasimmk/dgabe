#!/bin/bash
set -euo pipefail
gabe_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$gabe_root"
cargo build --locked --release
echo "Built target/release/dangerous-gabe"
