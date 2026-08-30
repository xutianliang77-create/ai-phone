# ENT-UI-012 Web 访客麦克风设备检查代码候选

日期：2026-08-31
状态：`in_progress`

## 本批功能

- 访客必须在入会前显式点击“检查麦克风”；未检查或检查失败时“加入音频会议”不可用。
- 检查固定调用 `getUserMedia({audio:true, video:false})`，不枚举、不显示、不持久化 device ID 或 label，也不读取
  guest invitation/token。
- 检查结果区分 `ready/denied/not_found/unavailable/failed`；非 HTTPS 安全上下文或缺少 mediaDevices 明确
  `unavailable`，不尝试入会。
- 成功或失败均在 `finally` 对临时 MediaStream 的全部 tracks 调用 `stop()`；ready 文案明确临时轨道已停止。
- 页面卸载时使未完成检查结果失效；fragment token 清理、页面内存保存、成员 AuthProvider 隔离和访客
  `screenShare=false` 边界保持不变。

## 已执行静态门禁

- TypeScript/esbuild 静态转译、350行和 `git diff --check`：通过。
- 未执行浏览器权限、设备、Vitest、Playwright、axe、视觉或真实 RTC 验收；代码候选不证明浏览器矩阵通过。
