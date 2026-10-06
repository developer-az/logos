#!/usr/bin/env bash
# Deletes the local kind cluster created by scripts/kind-up.sh.
set -euo pipefail
kind delete cluster --name "${CLUSTER:-logos}"
