# 验证范围

## 共识功能验证（2026-10-19）

在 Windows / Node 24 上使用模拟 CLI/API 验证；没有消耗真实 Codex、Claude 或 DeepSeek 模型额度。

- `npm test`：95 项单元/API 检查通过，包括原有 58 项以及新增 37 项共识检查。
- `test/consensus.test.mjs`：第一/二轮共识、双方全部投票组合、轮数上限、版本/哈希/身份错误、自然语言误报、旧确认失效、双方提案顺序、讨论与确认屏障、失败/超时/停止、恢复及磁盘故障。
- `test/consensus-api.test.mjs`：真实 HTTP 与 CLI 适配器、原生会话和旧聊天保留、普通聊天前后回归、DeepSeek 记录员仍能记录公开讨论、休眠拒绝、并发保护、实际 CLI 超时终止和聊天室重命名。
- `test/consensus-recovery.test.mjs`：实际启动/关闭/重启 Maple 进程，验证完成记录恢复、中断记录显示 FAILED、原聊天文件未改动。
- `test/browser-consensus.mjs`：2 项真实 Chromium 操作检查通过，覆盖默认关闭、轮数与输入校验、双方确认、最终方案、页面重载、停止、桌面与 390px 宽屏截图。
- 现有 `retry`、`provenance`、`scheduler-sequences`（18 个固定种子序列）、`automatic`、`claude-sessions` 集成脚本通过。
- `npm run test:package`：打包 38 个文件，包含共识模块/脚本/样式；打包后的服务器启动及资源加载通过。

### 已确认的历史测试问题

完整浏览器套件结果为 **8 通过、7 失败**，其中新增共识检查 2/2 通过。使用开发前的原始提交 `aaa0dd7` 在独立副本上运行相同浏览器套件，得到 **6 通过、完全相同的 7 个失败**，故没有把它们当成本次共识功能已修复或通过：

1. `browser-policy.mjs` 的 3 项检查依赖旧英文标签或旧英文 provenance 文案，当前中文界面不匹配。
2. `browser.mjs` 的错误 Retry、取消排队 Pair、Pair reviewer Retry、Pair fix Retry 共 4 项，仍使用英文 `Retry` 等可访问名称定位，当前中文按钮不匹配。

本次没有扩大修改范围去重写这些历史 UI 测试。原 `automatic.mjs` 还把新房间默认额外额度写为 4；原始提交也复现 `2 !== 4`。本次仅将此过时断言修正为 Maple 实际公开默认值 2，未改自动接续实现；该脚本随后通过。

本机已有 Chromium 的版本与新安装的 Playwright 默认下载版本不同，因此使用 `MAPLE_TEST_BROWSER_EXECUTABLE` 指定现有可执行文件完成浏览器检查。正常环境仍可按 Playwright 默认方式安装 Chromium；该变量仅供测试覆盖路径。

以上是本地模拟验证，不代表真实供应商 CLI 的所有版本、模型输出或账户环境均已验证。模型共识也不等于方案已得到客观验证。

## 既有 Maple 检查

Maple 0.1.x 的主要验收检查为 `npm test`，或 README 中的 Node 命令：

- 模型和思考强度切换、非法参数拒绝、登录令牌及来源保护。
- UI 和本地字体资源版本一致性。
- 公共默认值与个人偏好隔离。
- 摘要来源引用、用户决定证据、修订说明、原文保留和摘要接续。
- 账号额度读取、未知状态、余额查询和模拟重置卡幂等性。
- Windows DPAPI 加密回环。
- 上游核心预算协调逻辑。

检查只使用本地模拟 CLI/API，不连接真实付费模型。macOS/Linux 的记录员密钥保存暂不支持，不把聊天引擎可启动等同于所有功能跨平台可用。

另外在 Windows 上手动检查了 1280px 和 820px 窗口、字体实际加载、中文启动脚本兼容性、桌面启动及冷启动。页面示例内容是人工排版样本。

上游较大规模的 smoke、browser、integration 脚本仍保留作后续回归参考。它们面向原版 Parley，涉及旧默认值和原版 UI 结构；没有将其历史结果计入 Maple 的检查数量。执行这些套件前应先核对断言是否仍与 Maple 的产品行为一致。
