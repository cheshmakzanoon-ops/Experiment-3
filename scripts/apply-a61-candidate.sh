#!/usr/bin/env bash
# Temporary, hash-verified transport; removed after tested integration.
set -euo pipefail
cat docs/a61-transfer.0 docs/a61-transfer.1 > "$RUNNER_TEMP/a61.patch.xz"
echo '4c0a251f8d20d1d578f1ebd9b98ab524cb274a171f594e43192ad9a1c7bf033e  '"$RUNNER_TEMP/a61.patch.xz" | sha256sum --check
xz -dc "$RUNNER_TEMP/a61.patch.xz" > "$RUNNER_TEMP/a61.patch"
echo '4661c70b33ab6a3d7fc826a8e79f9ab9d67187c589ac3f79ff2194ab23d76f0a  '"$RUNNER_TEMP/a61.patch" | sha256sum --check
git apply --check --index "$RUNNER_TEMP/a61.patch"
git apply --index "$RUNNER_TEMP/a61.patch"
git apply --check --index docs/a61-controls.patch
git apply --index docs/a61-controls.patch
