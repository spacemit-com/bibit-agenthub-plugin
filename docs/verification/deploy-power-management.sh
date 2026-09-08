#!/usr/bin/env bash
# 在开发板 bianbu@10.0.91.51 上部署 0.2.3（开发签名）并完成 UI 闭环前的系统接线。
# 用法：将本脚本与两个 deb、apm 一起放到板端后执行（部分步骤需要 sudo）。
# 前置：两个 deb 已在 /tmp，apm 已在 /home/bianbu/apm，bibit 已伪造安装目录。
set -euo pipefail

DEB_PLUGIN=/tmp/bibit-agenthub-plugin_0.2.3_all.deb
DEB_CLI=/tmp/bibit-agenthub-cli_0.2.3_riscv64.deb
APM_SRC=/home/bianbu/apm
APM_DST=/usr/bin/apm

echo "== 1/6 校验 deb sha256 =="
echo "f3f77aef62f5d5cc347e71e7a164c2146e74de87310a7a8432adbc304a5a9fba  $DEB_PLUGIN" | sha256sum -c -
echo "7db10b43e5e254e4627323df84c7c958be9d5f21036d3b44d0d4f0a73e8dba37  $DEB_CLI" | sha256sum -c -

echo "== 2/6 安装两个 deb（需要 sudo）=="
sudo dpkg -i "$DEB_PLUGIN" "$DEB_CLI"

echo "== 3/6 安装 apm 到 Provider 默认路径（需要 sudo）=="
sudo install -m0755 "$APM_SRC" "$APM_DST"
test -x "$APM_DST" && echo "apm installed at $APM_DST"

echo "== 4/6 收紧缓存目录权限（apm 安全检查要求）=="
mkdir -p /home/bianbu/.cache
chmod 700 /home/bianbu/.cache

echo "== 5/6 Provider 自检 =="
/usr/libexec/bibit/bibit-agenthub --self-test

echo "== 6/6 重启唯一正式 Bibit GUI =="
# GUI 以 bianbu 运行在 Wayland/LXQt 会话（DISPLAY=:0, WAYLAND_DISPLAY=wayland-0）。
# 先结束旧进程，再以相同会话环境重新拉起。
pkill -x bibit-gui || true
sleep 2
export DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000
nohup /usr/bin/bibit-gui >/tmp/bibit-gui.log 2>&1 &
sleep 5
pgrep -x bibit-gui >/dev/null && echo "bibit-gui restarted (pid $(pgrep -x bibit-gui))" || { echo "bibit-gui failed to start"; tail -20 /tmp/bibit-gui.log; exit 1; }

echo "deploy done"
