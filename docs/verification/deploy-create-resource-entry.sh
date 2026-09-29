#!/usr/bin/env bash
# 在开发板上装 0.3.10 的插件 bundle，观察「创建资源」入口的两条降级路径。
#
# 用法（board 上需要有 root：sudo / root ssh）：
#   docs/verification/deploy-create-resource-entry.sh <board-host> <step>
#     step=1  只换插件 bundle（drop-in grant 仍是旧的，只有 service:store）
#             → 期望：入口 disabled，显示「当前宿主未提供发起会话的能力」
#     step=2  再换上 0.3.10 的 grant（含 host:actions）
#             → 期望：入口可点；点击后在板端 bi-bit 0.1.18 上得到
#               「当前宿主不支持发起会话」（宿主未登记 conversation.compose）
#     step=restore  还原备份
#
# 前置：本脚本在 `.worktrees/hub-compose` 下运行，产物已构建：
#   npm run build:plugin
#
# 为什么需要 root：目标路径归 root 所有，且宿主按文件名顺序读取
# `/etc/bibit/feature-capability-grants.d/*.json`，band 用户无法写入。
set -euo pipefail

BOARD=${1:?usage: $0 <board-host> <step>}
STEP=${2:?usage: $0 <board-host> <step>}
HERE=$(cd "$(dirname "$0")/../.." && pwd)
BUNDLE="$HERE/artifacts/agent-hub-0.3.10.bibit-plugin.tgz"
GRANTS="$HERE/debian/agenthub-feature-grants.json"

PLUGIN_DST=/usr/lib/bibit/plugins/agent-hub.bibit-plugin.tgz
GRANTS_DST=/etc/bibit/feature-capability-grants.d/agenthub.json
BACKUP=/tmp/agenthub-0.3.2-pre-upgrade

test -f "$BUNDLE" || { echo "build the plugin first: npm run build:plugin" >&2; exit 1; }
test -f "$GRANTS" || { echo "missing $GRANTS" >&2; exit 1; }

echo "== bundle sha256 =="
sha256sum "$BUNDLE"

case "$STEP" in
  1|2|restore) ;;
  *) echo "step must be 1, 2 or restore" >&2; exit 1 ;;
esac

echo "== 0/4 back up the current system files (once) =="
ssh "$BOARD" "sudo mkdir -p $BACKUP && \
  sudo test -f $BACKUP/agent-hub.bibit-plugin.tgz || sudo cp $PLUGIN_DST $BACKUP/agent-hub.bibit-plugin.tgz; \
  sudo test -f $BACKUP/agenthub.json || sudo cp $GRANTS_DST $BACKUP/agenthub.json; \
  echo backup:; sudo ls -l $BACKUP"

if [ "$STEP" = restore ]; then
  ssh "$BOARD" "sudo install -Dm0644 $BACKUP/agent-hub.bibit-plugin.tgz $PLUGIN_DST && \
    sudo install -Dm0644 $BACKUP/agenthub.json $GRANTS_DST && echo restored"
else
  echo "== 1/4 upload and install the new bundle =="
  scp "$BUNDLE" "$BOARD:/tmp/agent-hub-0.3.10.bibit-plugin.tgz"
  ssh "$BOARD" "sudo install -Dm0644 /tmp/agent-hub-0.3.10.bibit-plugin.tgz $PLUGIN_DST"

  if [ "$STEP" = 2 ]; then
    echo "== 2/4 install the 0.3.10 capability grant (adds host:actions) =="
    scp "$GRANTS" "$BOARD:/tmp/agenthub-feature-grants-0.3.10.json"
    ssh "$BOARD" "sudo install -Dm0644 /tmp/agenthub-feature-grants-0.3.10.json $GRANTS_DST && cat $GRANTS_DST"
  else
    echo "== 2/4 leave the old grant in place on purpose (host:actions is not approved) =="
    ssh "$BOARD" "cat $GRANTS_DST"
  fi
fi

echo "== 3/4 restart the GUI =="
# GUI 以 bianbu 跑在 Wayland/LXQt 会话（DISPLAY=:0, WAYLAND_DISPLAY=wayland-0）。
ssh "$BOARD" 'pkill -x bibit-gui || true; sleep 2; \
  sudo -u bianbu env DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 \
    nohup /usr/bin/bibit-gui >/tmp/bibit-gui.log 2>&1 & sleep 5; \
  pgrep -x bibit-gui >/dev/null && echo "bibit-gui restarted (pid $(pgrep -x bibit-gui))" \
    || { echo "bibit-gui failed to start"; tail -20 /tmp/bibit-gui.log; exit 1; }'

echo "== 4/4 observed state =="
ssh "$BOARD" "strings -a /usr/bin/bibit-gui | grep -c 'conversation.compose' || true"
cat <<'EOF'

现在切到板上 GUI 手工判读（单显示器：DISPLAY=:0 → :0.0）：

  step=1 期望：Agent Hub 页头「创建资源」按钮 disabled，旁边显示
               「当前宿主未提供发起会话的能力」；点击不发请求。
  step=2 期望：按钮可点；点击后显示「当前宿主不支持发起会话」
               （板端 bi-bit 0.1.18 未登记 conversation.compose）。

截图与自动化交互（板上已有 grim / wtype / slurp / ffmpeg）：
  ssh <board> 'DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 grim /tmp/hub.png'
happy path 判据（新会话打开、提示词预填、消息列表为空、补字后可发送）
需要「由 bibit 主线 >= 0e3d7b4 构建的 bi-bit」，本脚本不覆盖。
EOF
