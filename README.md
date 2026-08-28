# Bibit Agent Hub Plugin

Bibit Agent Hub 的独立前端插件，当前包含：

- Bibit 主侧边栏中的 Agent Hub 页面；
- Agent Hub 设置子页面；
- 传输无关的 `service:store` Host API 接入；
- 独立 Feature Dev Host；
- 签名插件构建和系统插件部署能力。

完整的代码边界、独立开发、服务协议、签名、部署、升级和验收步骤见：

- [Agent Hub 插件开发与部署指南](./docs/development-and-deployment-guide.md)
- [AgentHub CLI Provider 开发与部署指南](./docs/cli-provider-development-and-deployment.md)

快速启动：

```bash
npm ci
npm test
npm run typecheck
npm run dev
```

首次本地构建先生成开发签名 key，后续只需执行构建命令：

```bash
npm run keygen
npm run build:plugin
```

当前产物：`artifacts/agent-hub-0.3.0.bibit-plugin.tgz`。`.bibit-keys/` 中的私钥禁止提交。
