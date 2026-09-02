# 项目开发约定

1. Agent Hub 插件只维护前端 contribution、领域 DTO、operation 和开发 Mock；不得导入 Bibit 私有源码或直接连接业务后端。
2. 所有业务请求必须通过 `service:store`，`serviceId` 固定为 `store`，operation ID 必须带版本；不得新增 `external-service:*` 用法。
3. Host API 返回值是协议边界输入；新增或修改 DTO 时，必须同步更新 `src/storeContracts.ts`、组件、`dev/main.tsx` 和最小契约测试。
4. 设置 contribution 只能渲染 content-only 内容，禁止复制 Bibit 的 `HeaderPage`、设置侧栏、`main` 或外层滚动容器。
5. CSS 必须收口到 `.agent-hub*` 命名空间，禁止 `:root`、`html`、`body`、`#root` 和裸通配选择器。
6. 异步请求必须在组件卸载时取消；保存按钮必须防止重复提交，并保持局部 loading/error 状态。
7. React、React DOM 和全部 `@bibit/feature-*` 依赖必须与目标 Bibit 发布矩阵完全一致，不得单独升级 vendor 包。
8. 系统部署拆分插件 bundle 与 CLI Provider；CLI 包拥有 `/usr/libexec/bibit/bibit-agenthub` 和 `/etc/bibit/external-services.d/agenthub.json`，不得修改用户 home 下的 Registry。
9. 提交前必须执行 `npm test`、`npm run typecheck`、`npm run build:dev` 和 `npm run build:plugin`；开发私钥和构建产物不得提交。

建议所有 AgentHub 前端开发同事按以下顺序阅读：

- [README.md](./README.md) — 快速运行 Demo，了解 Dev Host Mock 与真实 CLI 的区别。
- [docs/development-and-deployment-guide.md](./docs/development-and-deployment-guide.md) — 最重要的模块开发手册，涵盖代码边界、UI、调试、构建、签名、安装和验收。
- [../bibit/docs/feature-sdk/file-transfer-and-jobs.md](../bibit/docs/feature-sdk/file-transfer-and-jobs.md) — 上传、下载、进度、取消、页面重进恢复的标准实现方式。
- [docs/cli-provider-development-and-deployment.md](./docs/cli-provider-development-and-deployment.md) — 负责 CLI 的同事必须阅读，包含 Registry、Provider Protocol v2、NDJSON、自检和部署结构。
- [../bibit/docs/feature-sdk/developer-guide.md](../bibit/docs/feature-sdk/developer-guide.md) — 说明插件 Manifest、页面、设置、Host API、能力申请以及禁止依赖的 Bibit 私有接口。

按职责选读：

- UI 和设置页开发：[../bibit/docs/feature-sdk/settings-content-contract.md](../bibit/docs/feature-sdk/settings-content-contract.md)
- 插件打包、签名、系统安装：[../bibit/docs/feature-sdk/trusted-plugin-guide.md](../bibit/docs/feature-sdk/trusted-plugin-guide.md)
- CLI/HTTP Provider 协议实现：[../bibit/docs/feature-sdk/provider-framework.md](../bibit/docs/feature-sdk/provider-framework.md)
- capability、错误码与排障：[../bibit/docs/feature-sdk/host-capabilities.md](../bibit/docs/feature-sdk/host-capabilities.md)