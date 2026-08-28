# 项目开发约定

1. Agent Hub 插件只维护前端 contribution、领域 DTO、operation 和开发 Mock；不得导入 Bibit 私有源码或直接连接业务后端。
2. 所有业务请求必须通过 `external-service:store`，`serviceId` 固定为 `store`，operation ID 必须带版本。
3. Host API 返回值是协议边界输入；新增或修改 DTO 时，必须同步更新 `src/storeContracts.ts`、组件、`dev/main.tsx` 和最小契约测试。
4. 设置 contribution 只能渲染 content-only 内容，禁止复制 Bibit 的 `HeaderPage`、设置侧栏、`main` 或外层滚动容器。
5. CSS 必须收口到 `.agent-hub*` 命名空间，禁止 `:root`、`html`、`body`、`#root` 和裸通配选择器。
6. 异步请求必须在组件卸载时取消；保存按钮必须防止重复提交，并保持局部 loading/error 状态。
7. React、React DOM 和全部 `@bibit/feature-*` 依赖必须与目标 Bibit 发布矩阵完全一致，不得单独升级 vendor 包。
8. 系统部署只使用模块拥有的插件 bundle 和 `/etc/bibit/external-services.d/agenthub.json`，不得修改用户 home 下的 Registry。
9. 提交前必须执行 `npm test`、`npm run typecheck`、`npm run build:dev` 和 `npm run build:plugin`；开发私钥和构建产物不得提交。
