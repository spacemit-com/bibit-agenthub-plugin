# Bibit Agent Hub Plugin

独立开发：`npm install && npm run dev`。Feature Workbench 会注入模拟 Store Host API，无需启动服务或编译 Bibit。

构建签名插件：`npm run keygen && npm run build:plugin`。产物位于 `artifacts/agent-hub-0.1.0.bibit-plugin.tgz`；`.bibit-keys` 私钥不得提交。正式发布时将 `vendor` 依赖替换为公司 npm Registry 的同版本 `@bibit/*` 包，并把 `agents.list` 对接到平台注册的 Store adapter。
