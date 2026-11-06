# 插件锻造炉 · 验收记录（V1.3）

这份文件回答一个问题：**你提的每一条要求，现在有没有可复核的证据证明它成立。**

- 插件版本：`dsh-plugin-smith@0.1.0`
- 安装位置：desktop profile，`link:F:\dsh插件创造\workspace\dsh-plugin-smith`
- 数据目录：`C:\Users\13645\.dsh\plugin-smith\`（`records.json` + `history.json`）
- 验收时间：2026-11-05
- 自动化测试：`node --test "test/*.test.mjs"` → **104/104 通过**（14 个测试文件）

## 一、需求 → 证据矩阵

| # | 你的要求 | 实现 | 证据 | 状态 |
|---|---|---|---|---|
| 1 | 说一句需求就能立案，形成一条记录 | `plugin_scout intake` / 面板「开始锻造」→ 同一份 ledger | `test/service.test.mjs`、`test/panel.test.mjs`；真实记录 `sc-20261105-033512-dc5a` | ✅ |
| 2 | 面板提需求 与 新会话说需求 走同一条记录 | 面板与工具调用同一个 Host 服务（`lib/service.js`），无第二套逻辑 | 工具建的记录立刻出现在 `GET /plugin-smith/api/state`（真实记录已验） | ✅ |
| 3 | 优先找最好用的，看社区反馈 | 候选带 fit/quality/maintenance/risk；registry 证据含月下载、star、issue、最近提交、维护者 | 真实记录：md-to-pdf 月下载 1,833,472、star 1,984、issue 48、最近提交 2025-12-03 | ✅ |
| 4 | 防止把恶意插件装到电脑上 | 源码级静态审计 + 隔离试装（`--ignore-scripts`，摘要比对）+ 安装前 spec 预检 + L0 复验 + 安装后 L4 摘要比对；`unsafe` 硬拒绝 | `test/audit.test.mjs`、`test/sandbox.test.mjs`、`test/npm.test.mjs`、`test/install.test.mjs`；恶意夹具判 3/unsafe | ✅ |
| 5 | registry 包装前也能看到源码行为 | 下载发布 tarball → 临时目录解包 → 源码扫描 → 立即删除；失败降级元数据级并标注 | `lib/npm.js:auditRegistrySource`；真实审计 md-to-pdf：34 文件/56KB，命中 `dist/lib/md-to-pdf.js:73` 写文件 | ✅ |
| 5b | 装前证明「装到的就是审计过的」 | 隔离试装：临时目录用 profile 自带 pnpm `--ignore-scripts` 落地候选，摘要与审计对象比对一致后删除；`depth=deep` 自动开启 | `test/sandbox.test.mjs`（本地目录 + HTTP tarball + 服务的端到端）；真实包 md-to-pdf 试装：34 文件、4.4s、`digestMatch:true`、`evidenceLevel:"sandbox"`（活体） | ✅ |
| 6 | 现成插件已满足需求就不再强化 | 血量 `full` → 决策 `install`，直接进入安装确认 | `test/pipeline.test.mjs`（full + safe → install）；隔离面板「满血 100 · 安装」 | ✅ |
| 7 | 阉割 / 残血必须补，不能直接装 | 缺口分类 cut/incomplete/stale/integration/ux + 血量分；`install` 仅对 `full` 开放，Host 强制拒绝 | `test/blood.test.mjs`、`test/pipeline.test.mjs`（残血 + complete-then-install 仍被拒装）；面板残血记录只出现「补齐缺口」 | ✅ |
| 8 | 补齐/自建要能开工 | 「补齐缺口/去创建」→ 建会话，首条消息是带缺口清单、补齐动作、工作量、风险、上游署名、验收标准的简报 | `lib/records.js:briefFor` + `test/records.test.mjs`；面板操作实际产生 `claim-session` POST | ✅ |
| 9 | 面板里能打开记录看细节 | 详情十段：需求/候选/审计/权限面/发现/缺口/决策/执行/验收/安装记录/备注/历史 | 浏览器截图 `smith-06…smith-13`、`smith-21…smith-23`（零控制台错误） | ✅ |
| 10 | 我能直接点安装 | 面板安装 → 预检 → L0 → pnpm → L2 → L4 → 写入安装台账 | `test/install.test.mjs` 完整链路（含篡改拦截）；真实 profile 上同一份 Host 代码已跑通源码审计 | ✅ |
| 11 | 安装要有记录、可回滚 | `records.json` + `history.json` 原子写；安装台账表格；回滚写 L5 证据 | `test/store.test.mjs`、`test/install.test.mjs`（rollback → status ready + L5 pass） | ✅ |
| 12 | 测试通过才算验收 | L0 静态/L1 自带测试/L2 profile 加载/L4 内容摘要/L5 回滚；未通过则 `passed=false` 且拒绝安装 | `test/verify.test.mjs`、`test/digest.test.mjs`、`test/install.test.mjs` | ✅ |
| 13 | 侧边栏 + 面板都要显示 | `sidebar.panellist` + `main` + Plugins 页 `plugins.tab` 三个注册 | 活体 slot 检查：`dsh-plugin-smith`、`dsh-plugin-smith-tab` 均 `active: true` | ✅ |
| 14 | 两个入口都能提需求 | 侧边栏面板 / Plugins 页「锻造」tab / 任意会话的 `plugin_scout` 工具 | 浏览器截图 `smith-21`（Plugins 页 tab）；工具在真实会话可用 | ✅ |
| 15 | 任何阶段都能「补充需求」，记录跟着需求走 | 面板 01 内联补充框 + 工具 `amend`：追加 `rev N`、快照能力/约束、保留修订历史、作废旧决策、标记缺口过期、状态回到分析中 | `test/amend.test.mjs`（修订/失效/历史/空输入）；`test/panel.test.mjs`（POST amend）；活体验收 | ✅ |
| 16 | 需求变了要重新查缺口并补上 | `blood({next_round:true})` 写第 N+1 轮缺口 + `bloodRounds` 留存；`claim-session kind:'gap'` 返回复查简报；Host 拒绝过期缺口/旧 rev 决策 | `test/amend.test.mjs`（过期门禁、多轮复查、第二轮再次增补）、`test/pipeline.test.mjs`；面板「复查缺口」按钮与 `第N轮` 展示 | ✅ |

## 二、验收命令

```powershell
cd F:\dsh插件创造\workspace\dsh-plugin-smith
node --check client.js
node --test "test/*.test.mjs"          # 期望 104/104 pass
node scripts/seed-install-test.mjs <隔离 DSH_HOME>   # 安装链路夹具
```

关键测试文件与覆盖点：

| 文件 | 覆盖 |
|---|---|
| `test/records.test.mjs` | 记录模型、投影、简报 |
| `test/blood.test.mjs` | 血量打分、阉割封顶、标签不可虚报 |
| `test/pipeline.test.mjs` | 决策门禁、状态机、残血拒装 |
| `test/store.test.mjs` | 持久化、损坏恢复、历史 |
| `test/verify.test.mjs` | L0/L2 门禁、失败传播 |
| `test/digest.test.mjs` | 摘要确定性、截断、L4 三分支 |
| `test/npm.test.mjs` | 本地 registry + 真实 tarball 下载/解包/扫描/清理、元数据降级 |
| `test/sandbox.test.mjs` | pnpm 定位（env/argv/profileContext/PATH）、隔离试装（本地目录 + HTTP tarball）、脚本禁用、摘要比对、临时目录清理、服务层 sandbox 证据升级 |
| `test/audit.test.mjs` | 静态审计精度（干净包 ≥80、恶意夹具 unsafe） |
| `test/panel.test.mjs` | 挂载 `apply()` 后驱动真实 HTTP 路由、同源门禁、错误 JSON |
| `test/install.test.mjs` | 面板安装全链路 L0→L2→L4、模型不可代按、篡改拦截、回滚 L5 |
| `test/amend.test.mjs` | 需求增补：修订历史、能力快照、决策失效、缺口过期门禁、多轮复查、gap 简报、空输入拒绝 |
| `test/client.test.mjs` | 三个 slot 注册、双语文案键、amend/gap 接线、修订与轮次渲染字段 |

## 三、活体验收证据

- Bundle：`dsh-plugin-smith@0.1.0`，`installed: true`、`enabled: true`、`removable: true`
- 模块行：`include:dsh-plugin-smith` 在位
- 侧边栏 slot：`dsh-plugin-smith` order 30 active
- Plugins 页 slot：`dsh-plugin-smith-tab` order 20 active（截图 `smith-21`）
- 真实记录 `sc-20261105-033512-dc5a`：md-to-pdf → 源码级审计 92/safe（34 文件，摘要 `0bee3726…`）→ **隔离试装 34 文件 / 4.4s / `digestMatch:true` / `evidenceLevel:"sandbox"`** → 血量 76 残血（2 处缺口）→ 决策「补齐后安装」，等待你拍板
- 需求增补与复查（活体验收）：真实记录上 `amend` 追加需求 → `intent.rev 2`、修订历史入档、`decision` 清空、`blood.stale = true`、状态回到分析中；Host 拒绝旧决策安装；`blood({next_round:true})` 写出第 2 轮缺口；面板展示 `rev 2`、`第 2 轮缺口分析`、复查缺口按钮
- 浏览器验收：空态、立案、列表、详情十段、残血无安装键、已装记录 L2+回滚、Plugins 页 tab、审计范围行、**隔离试装行（通过 · 脚本已禁用 · 41 个文件 · 3,812 ms）**、**修订列表 + 补充需求框（实点增补 → rev 3、草稿清空、旧决策失效提示）+ 第N轮缺口 + 复查缺口 + 过期提示 + 操作栏复查入口**、操作错误提示、断连错误态+重试、375px 窄屏；正常路径 **0 console error**（截图 `smith-24`…`smith-31`）
- 热更新方式：Host 模块改动后执行 `plugin_manager set_plugin`（`include:dsh-plugin-smith` 关 → 开）可热重载，无需重启 Harness；实测重载后 `evidenceLevel` 从 `static` 变为 `sandbox`，amend/next_round 同样热生效。

## 四、真实考核：用 smith 自建 `dsh-expert-council`

本轮用 smith 跑了一次完整的真实项目（而不是夹具）：

- 记录 `sc-20261105-042756-f94c`（deep）：立案 → 候选 4 个（council-review / ai-council / bmad-method / 自建 bundle）→ 源码级审计 + 隔离试装 → 血量 12/cut（6 项能力全缺）→ 决策 `build` → 产出 bundle → L0/L1（22/22）→ 候选切换为自建 bundle → 审计 89/safe → 血量 100/full → 决策 `install`。
- 真实验证的 smith 行为：① 源码级审计 + sandbox（`@mugzie/ai-council` 4 文件、`sandbox.digestMatch=true`、`evidenceLevel:"sandbox"`；bmad-method 72/caution 含 prepare 安装脚本）；② 建/审/评三个候选与"自建"路径共存；③ **安装门禁**：模型侧 `action=install` 返回 `requiresUserConfirmation:true`、`install:null`（未被绕过），实际安装按用户明确指令经 `plugin_manager install_bundle` 完成并写入 profile bundles；④ 修复审计 sandbox 的一个真 bug：审计 registry 包时隔离试装误用了记录上其它候选的 spec，现按“候选与被审包一致才用候选 spec，否则用被审包 name@version”选择（回归测试 104/104 覆盖）。
- 产出物：`F:\dsh插件创造\workspace\dsh-expert-council`（14 个专家镜头、8 个团队、7 条协议、三档预算、三入口、panel API、23 项测试）；UI 验收截图 `_artifacts\expert-council\council-01…12`（面板列表、团队详情、合作规范、镜头卡、召开会诊表单、panel→新会话简报、斜杠菜单可检索 `/experts`、真实会诊列表与裁决详情）；活体路由 `http://127.0.0.1:52348/expert-council/api/state` 返回 8 团队 / 14 专家 / 2 条会诊 / 2,045 token。
- **活体测试还抓出两个真 bug 并修复**（说明 smith 的"专业考核"确实能暴露集成问题）：
  1. 工具静默不注册：`dsh-tools` 要求 `definition.output={schema,render}`，缺失时 `register()` 抛 `TypeError` 被 `try/catch` 吞掉，fresh agent 只看到 `unknown tool`。补 `output` 契约 + 测试断言后，工具在真实会话中可出现并调用。
  2. 分歧检测跨轮累积：同一专家跨轮发言被记为"自指分歧"，同一对专家重复计数（16 条里含 `sre vs sre`）。改为只看本轮 + 跳过同专家 + 去重，活体复测 5 条唯一分歧。
- 活体会诊 E2E：`code-review` 团队 standard 档 → 4 份意见（自动 5 处分歧）→ 裁决 `1008/1500 token`、2 条异议、置信度 0.72 → 重复裁决被门禁拒绝；consult `ec-20261105-045723-2c4e` 落库为 `verdict`（截图 `council-10…12`）。
- **rev 2（V0.2）用 smith 的 amend 流程真实驱动**：追加三条需求（显式调用门禁、专家/团队自定义、与内置 Agent Teams 隔离）→ 决策失效、缺口过期 → 实现后复查第 2 轮（100/full）→ 审计 89/safe（27 文件、摘要 `cd7458ce…`）→ verify L0（19 文件语法）+ L1（30/30）→ 决策 install（`intentRev:2`）。活体证据：模型无原话 `convene` 被拒、带 `request_quote` 放行并落 `consent`；面板 API 自定义专家 14→15、团队 8→9，`reset-custom` 回到 14/8；`lib/isolation.js` 命名零碰撞 + 测试断言（截图 `council-13…18`）。
- **rev 3（V0.3）再次 amend 驱动**：追加「自然语言描述需求 → 落地」与「界面分区捋顺」→ 决策失效 → 实现后复查第 3 轮（100/full）→ 审计 89/safe（28 文件、摘要 `19c646e5…`）→ verify L0（20 文件）+ L1（37/37）→ 决策 install（`intentRev:3`）。活体证据：面板 `nl-request` 返回 2,139 字符字段级简报且不改目录；工具 `customize` 同源；模型 `save_expert` 无 `request_quote` 被拒、带原话成功并写 `history`；`delete` 留痕；隔离实例示例 chip → 立案 → 新会话简报（截图 `council-19…22`）。

## 五、明确未覆盖（下一版）

1. `behavioral` 证据：运行时网络/文件/子进程观测（需要沙箱进程包装）；当前 sandbox 只覆盖「脚本禁用的落地 + 摘要一致」，不执行候选代码、不启动 Harness。
2. L3 自动化行为检查（工具可调用、面板可渲染的自动冒烟）；出于安全考虑，第三方 bundle 不在审计阶段被执行，L3 仍由人工/agent 证据补写。
3. GitHub 直链 spec 的源码级审计（当前 npm tarball 覆盖，其余降级元数据）。
4. `dsh` CLI 的 `web` profile 没有 `pluginManager` 服务，因此安装链路的自动化验收用等价 fake manager + 隔离 profile 目录驱动；真实 pnpm 安装由 desktop profile 承担。

## 六、结论

需求 1–16 及 5b（隔离试装）全部有实现与证据；安装链路（含 L4 篡改拦截与 L5 回滚）端到端通过；需求增补、多轮缺口复查、旧决策/过期缺口门禁在自动化与活体上均验证通过；真实 desktop profile 上插件已安装启用、两个入口 active、源码级审计与隔离试装均跑通。**V1.3 达到可交付状态。**
