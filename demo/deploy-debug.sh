#!/bin/sh
set -eu

demo_root=${1:-/home/bianbu/bibit-agenthub-demo}
plugin_bundle=${2:-artifacts/agent-hub-0.3.0.bibit-plugin.tgz}
trust_store=${3:-.bibit-keys/agent-hub-development-trust-store.json}

python_bin=$(command -v python3 || command -v python || true)
if [ -z "$python_bin" ]; then
  echo "Python 3 is required for the AgentHub mock Provider." >&2
  exit 1
fi
if [ ! -f "$plugin_bundle" ] || [ ! -f "$trust_store" ]; then
  echo "Build the plugin and provide its bundle and trust store." >&2
  exit 1
fi

install -d -m 700 "$demo_root/bin" "$demo_root/config" "$demo_root/grants" \
  "$demo_root/plugins" "$demo_root/data" "$demo_root/xdg-data" "$demo_root/logs"
install -m 700 demo/cli/bibit-agenthub-mock-provider.py "$demo_root/bin/provider.py"
install -m 600 deploy/agenthub-feature-grants.example.json "$demo_root/grants/agenthub.json"
install -m 600 "$trust_store" "$demo_root/config/trust-store.json"
install -m 600 "$plugin_bundle" "$demo_root/plugins/$(basename "$plugin_bundle")"

launcher="$demo_root/bin/bibit-agenthub"
printf '#!/bin/sh\nexec %s %s provider\n' "$python_bin" "$demo_root/bin/provider.py" > "$launcher"
chmod 700 "$launcher"

"$python_bin" - "$demo_root" <<'PY'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
source = json.loads(Path('demo/registry/agenthub-provider.json').read_text())
source['services']['store']['executable'] = str(root / 'bin' / 'bibit-agenthub')
(root / 'config' / 'provider.json').write_text(json.dumps(source, indent=2) + '\n')
PY

echo "Debug assets prepared under $demo_root"
echo "Launch the development Bibit binary with:"
echo "XDG_DATA_HOME=$demo_root/xdg-data JAN_DATA_FOLDER=$demo_root/data BIBIT_EXTERNAL_SERVICE_CONFIG=$demo_root/config/provider.json BIBIT_FEATURE_CAPABILITY_GRANTS_DIR=$demo_root/grants BIBIT_SYSTEM_PLUGIN_DIR=$demo_root/plugins BIBIT_PLUGIN_TRUST_STORE=$demo_root/config/trust-store.json <bibit-debug-binary>"
