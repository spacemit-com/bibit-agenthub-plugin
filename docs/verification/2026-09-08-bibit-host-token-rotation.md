# Bibit 宿主阻塞报告：多 surface 轮换 feature-instance token 导致插件外部服务请求全部 unauthorized

日期：2026-09-08
报告方：bibit-agenthub-plugin 团队
影响版本：板端 bi-bit 0.1.3（riscv64，正式 release 构建）

## 现象

Agent Hub 插件（`bibit-agenthub-plugin` 0.2.3，开发签名）在板端正式 GUI 内，market 页与设置页均无法加载，页面报「Power catalog authorization is required / Could not load」。原生日志：

```text
external_service.request_unauthorized feature=agent-hub version=0.2.3 service=store operation=powers.list.v1 request=799fd0fa-…
external_service.request_unauthorized feature=agent-hub version=0.2.3 service=store operation=settings.get.v1 request=000ecb82-…
```

`settings.get.v1` 是编译期 grant 内置的 operation（`src-tauri/src/feature_capabilities.rs` 的 `COMPILED_GRANTS`），它同样被拒，说明失败不在插件的 drop-in grant，而在 feature-instance token 校验。

## 根因

宿主进程在启动时创建了两个 webview surface，`surface-diag` 日志：

```text
[surface-diag] window= main webview= main surface= main
[surface-diag] window= voice-overlay webview= voice-overlay surface= voice-overlay
```

两个 surface 都执行了插件加载链路，`Loaded trusted plugins` 出现两次、`Failed to bootstrap` 出现一次：

```text
Loaded trusted plugins: agent-hub@0.2.3
Loaded trusted plugins: agent-hub@0.2.3
Failed to bootstrap trusted plugin agent-hub@0.2.3: plugin access is restricted to the main window
```

具体链路：

1. `web-app/src/main.tsx` 的 `boot()` 只对 `voice-ball` 提前返回（`if (surface === 'voice-ball')`），`voice-overlay` 与 `main` 一样继续执行 `loadTrustedPluginEntries()` → 原生 `trusted_plugin_prepare_active`。
2. 原生 `trusted_plugin_prepare_active`（`src-tauri/src/trusted_plugins.rs:2029-2115`）末尾对每个激活插件调用 `attach_feature_instance(plugin, true)`（`force_rotate=true`）。`register_feature_instance` 在 `force_rotate=true` 时无条件生成新 token 覆盖旧 binding（同文件 `194-230`）。
3. 原生 `trusted_plugin_bootstrap`（同文件 `2118-2133`）带 `ensure_main_surface(window.label())` 门禁，因此 `voice-overlay` 的 bootstrap 被拒（日志中的 `restricted to the main window`）。
4. 时序：`main` 先 `prepare_active`（token T1）→ `main` bootstrap 消费 T1 → `voice-overlay` 再 `prepare_active`（轮换为 T2）→ `main` 里插件持有的 T1 失效。
5. 后续请求经 `validate_feature_instance_version_capability`（`src-tauri/src/trusted_plugins.rs:324` 附近）判定 `binding.token != token`，返回 false，最终 `external_services.rs` 记录 `request_unauthorized` 并回 `unauthorized`。

## 证据要点

- 两个 surface 的 `surface-diag` 日志（见上）。
- `Loaded trusted plugins` 两次 + `Failed to bootstrap … restricted to the main window` 一次，说明只有一个 surface 的 bootstrap 失败，但两个 surface 都执行了 `prepare_active`。
- `settings.get.v1`（编译期 grant 内置）同样 `request_unauthorized`，排除 grant 合并问题，定位到 token 校验。
- 插件的 drop-in grant（`/etc/bibit/feature-capability-grants.d/agenthub.json`）经前端 grant 检查放行（请求到达原生），与原生授权共用同一 `runtime_grants()`，说明 grant 本身正确。

## 修复建议（任选其一）

方案 A（推荐，前端最小改动）：`web-app/src/main.tsx` 只在主 surface 加载插件：

```ts
const surface = currentWindowSurface()
if (surface === 'main') {
  const [pluginEntries] = await Promise.all([
    loadTrustedPluginEntries(),
    loadRuntimeFeatureCapabilityGrants(),
  ])
  setRuntimeFeatureRegistry(pluginEntries)
}
```

方案 B（原生加固，与 bootstrap 门禁对齐）：给 `trusted_plugin_prepare_active` 增加 `ensure_main_surface` 门禁，从源头阻止非主窗口调用 `attach_feature_instance(force_rotate=true)` 轮换 token。

## 影响范围

- 影响所有通过 `service:*` 走外部服务的可信插件（非本插件独有），任何多 surface 桌面构建（`voice-overlay` 恒在 `desktop` feature 下创建）都会复现。
- 不走 external service 的静态 feature / 内置插件不受影响。
- 建议修复后回归：主窗口插件 bootstrap 正常、`voice-overlay` 不触发 `prepare_active`、`request_unauthorized` 消失。
