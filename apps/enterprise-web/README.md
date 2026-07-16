# 无界AI企业版 Web

`@translation/enterprise-web` 是企业控制台的生产应用基础，当前交付真实手机号登录、会话恢复、账号自己的 active memberships 发现、租户选择、scope 导航和受保护路由。

## 技术基线

- React 19 + TypeScript 5.9。
- Vite 8 构建与本地反向代理。
- React Router 7 客户端路由。
- Vitest + Testing Library 单元和交互测试。
- Fontsource 自托管 Material Icons，不依赖运行时外部字体服务。

## 本地运行

先在仓库根目录安装依赖并启动 API：

```bash
npm install
npm run dev:api
```

再启动企业 Web：

```bash
npm run dev -w @translation/enterprise-web
```

开发服务器默认把 `/api` 反向代理到 `http://127.0.0.1:3000`。如 API 使用其他端口，只为本地命令设置 `ENTERPRISE_API_PROXY_TARGET`。生产构建默认请求同源 `/api`；部署层必须提供 HTTPS、SPA fallback 和 `/api` 反向代理，也可以在构建时设置 `VITE_ENTERPRISE_API_BASE_URL`。

## 会话边界

现有账号 API 只提供 Bearer token，因此 Web 当前把 token 保存在 `sessionStorage`，关闭标签页后不长期保留。每次恢复会话都会重新请求企业成员关系、短期签名 route document 和 `/enterprise/v1/me`；route document 的 tenant、homeRegion、cell、有效期或公开 URL 协议不匹配时不会进入工作台。过期或 401 会立即清理本地会话。若服务端后续提供 SameSite HttpOnly Cookie，应迁移到服务端会话并保持这层状态机不变。

工作台从 `/enterprise/v1/provider-capabilities` 读取 capability document，只展示服务端返回的 `ready/checking/degraded/not_configured/not_ready` 真值，不回显 Provider 地址或敏感配置。`/settings/jobs/:jobId` 展示租户生命周期 job 的 `processing/failed/completed` 终态，409/412 统一映射为冲突状态；其余尚未接入的业务页面继续以 `尚未就绪` 明示，不注入设计示例或伪造成功状态。
