# Bibit Agent Hub Plugin

Bibit Agent Hub 的独立前端插件，当前包含：

- Bibit 主侧边栏中的 Agent Hub 页面；
- Agent Hub 设置子页面；
- 传输无关的 `service:store` Host API 接入；
- 通过 `file:transfer`、`job:manage` 和 Provider Protocol v2 完成上传、下载、进度、取消与页面重进恢复；
- 可独立运行的内存 Host API Mock，以及经 Tauri Bibit 调用的 managed stdio 模拟 CLI；
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

浏览器 Dev Host 只验证插件前端和内存 Host API Mock，不会启动 CLI。真实 Provider 链路需要先构建插件并准备隔离调试目录：

```bash
npm run keygen
npm run build:plugin
python3 demo/cli/bibit-agenthub-mock-provider.py --self-test
./demo/deploy-debug.sh /home/bianbu/bibit-agenthub-demo
```

脚本会输出启动目标 Tauri Debug Bibit 所需的完整环境变量。不要把 Dev Host 的 Mock 成功当成真实 CLI 已接通。

当前产物：`artifacts/agent-hub-0.3.0.bibit-plugin.tgz`。`.bibit-keys/` 中的私钥禁止提交。
