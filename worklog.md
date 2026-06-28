---
Task ID: 2 (cron webDevReview 第 1 轮)
Agent: main (Z.ai Code)
Task: DataOps 管理台持续开发巡检 — QA 测试 + 新增功能 + 样式打磨

Work Log:
- 读取 worklog.md 了解项目进展：9 视图 mock 原型已完成，lint 通过，agent-browser 验证全可用
- QA 测试（agent-browser）：
  - dev server 正常 (port 3000, 200)
  - 9 视图遍历：全部无水平滚动、无运行时错误
  - 仅 1 个已知 shadcn Dialog aria-description warning（非阻断）
  - VLM 分析截图确认视觉层次清晰，给出样式改进建议
- 新增功能 1：暗色模式完善
  - 创建 theme-provider.tsx (next-themes, attribute="class")
  - 创建 theme-toggle.tsx (Sun/Moon 图标平滑切换动画)
  - layout.tsx 包裹 ThemeProvider
  - 顶栏集成 ThemeToggle 按钮
  - 修复 lint: setState-in-effect 规则（改用 queueMicrotask 模式）
- 新增功能 2：SQL Playground 视图（第 10 个页面）
  - sql-playground-view.tsx：三栏布局（表清单/编辑器+结果/参考）
  - SQL 编辑器（monospace textarea, Ctrl+Enter 执行）
  - mock 执行引擎：根据 SQL 关键字返回不同 mock 结果（COUNT/板块/骗炮/K线）
  - 结果表格渲染（列头+行，数字蓝色字符串默认色）
  - 保存的查询（4 个示例：涨停股/板块Top/K线统计/骗炮候选）点击载入
  - 执行历史（带耗时/行数/成功状态）
  - 字段参考 tab（点击列名插入编辑器，点击表名插入表名）
  - 执行状态：loading spinner + 成功 badge + 耗时 ms 显示
- 新增功能 3：执行详情抽屉（run-detail-sheet.tsx）
  - 编排页执行历史行可点击 → 打开右侧抽屉
  - 显示：run_id / 触发方式 / 耗时 / 入库行数 / force / 开始结束时间
  - 错误信息高亮区（失败红/警告黄）
  - mock 执行日志生成（根据表名生成不同的进度日志）
  - 重新执行 / 强制重跑 按钮
  - 日志文件路径显示
- 改进：编排 DAG 视图
  - 节点悬停效果（scale + shadow + ring）
  - 增加外部数据源节点（TQ API / TDX .day / .lc5 / .lc1 / gpsz / signals）
  - 层级描述说明
  - 红色异常节点带脉冲圆点
- 样式打磨：
  - 顶栏按钮组间距优化
  - 执行历史行 hover 天蓝色高亮 + 箭头图标
  - DAG 节点颜色语义统一（绿正常/红异常/灰once/蓝外部）
  - footer 更新为 10 视图
- 验证：
  - bun run lint 通过（0 error）
  - agent-browser 验证：10 视图全可切换（h1 标题全部正确）、SQL 执行成功显示结果、暗色切换 html class="dark"、执行详情抽屉打开显示 run_id+错误+日志
  - VLM 确认 SQL Playground 三栏布局合理、视觉专业
  - 截图存档：download/dataops-dashboard-final.png, dataops-sql-final.png

Stage Summary:
- 项目当前状态：稳定，功能持续增强。从 9 视图扩展到 10 视图，新增暗色模式、SQL Playground、执行详情抽屉三大功能
- 已完成的修改：
  1. 暗色模式：ThemeProvider + ThemeToggle，全站 dark: 变体生效
  2. SQL Playground：完整三栏查询界面，mock 执行引擎，保存查询/历史/字段参考
  3. 执行详情抽屉：编排历史可点击展开，含元数据/错误/日志/操作
  4. DAG 改进：悬停交互 + 外部源节点 + 层级描述
  5. lint 通过，无运行时错误
- 验证结果：10 视图遍历全部 h1 正确，SQL 执行出结果，暗色切换生效，抽屉打开正常

Unresolved / 下一阶段优先事项:
- SQL Playground 可加：表清单搜索框、SQL 语法高亮、结果排序/分页
- 血缘视图可升级为 react-flow 交互式图谱（当前是三栏列表式）
- 可加全局搜索（Cmd+K 命令面板）快速跳转表/脚本
- 可加执行实时进度条（WebSocket 推送 mock）
- 数据字典可加"中英文列名对照表"导出功能
- 接真实 API（E3 阶段）仍是最大未完成项
- lint engine 12 条规则的 Python 实现仍未做（E1 阶段）

---
Task ID: 3 (cron webDevReview 第 2 轮)
Agent: main (Z.ai Code)
Task: DataOps 管理台持续开发巡检 — QA 测试 + 修 bug + 新增功能 + 样式打磨（v2）

Work Log:
- 读取 worklog.md 了解项目进展：v1 已完成 10 视图（含 SQL Playground、暗色模式、执行详情抽屉）
- QA 测试（agent-browser）：
  - dev server 正常 (port 3000, 200)
  - 10 视图遍历全部可访问
  - 发现 bug：console 报错 "Can't perform a React state update on a component that hasn't mounted yet"
  - 根因：theme-toggle.tsx 用 `queueMicrotask(() => setMounted(true))` 在 render 期触发 setState
- 修复 bug 1：theme-toggle.tsx 重写
  - 删除 mounted 态 + queueMicrotask hack
  - 改用 CSS dark: 变体控制图标可见性（Sun 用 `block dark:hidden`，Moon 用 `hidden dark:block`）
  - 零 setState，零 useEffect，零 hydration mismatch
  - 通过 react-hooks/set-state-in-effect lint 规则
- 新增功能 1：全局命令面板 (Cmd+K Command Palette)
  - 创建 command-palette.tsx (280 行)
  - 全局快捷键 Cmd/Ctrl+K 唤起，Esc 关闭
  - 6 个分组：导航(10) / 快捷操作(2) / 数据表(26) / 告警(8) / Lint规则违规 / 最近执行
  - 实时搜索过滤（支持表名/中文名/脚本名/告警内容）
  - 选中项高亮，回车执行
  - 顶栏新增「搜索...⌘K」按钮入口
- 新增功能 2：通知中心抽屉 (notification-center.tsx, 145 行)
  - 顶栏新增铃铛按钮（带未读数红点 badge）
  - 右侧抽屉展示全部告警
  - 三个筛选 tab：全部 / 红 / 黄
  - 单条告警可「忽略」(X 按钮)，可「全部忽略」
  - 「查看详情」跳转到对应视图（lint/health/orchestration）
  - 「恢复已忽略」可撤销
- 新增功能 3：Dashboard 全面增强
  - KPI 卡片底部加 Sparkline 微折线（5日趋势）
  - 新增「近 7 日执行成功率」环形图（SVG donut，颜色随成功率变绿/黄/红）
  - 7 日每日成功率横向条形图
  - 新增「每日入座行数趋势」区域图（SVG area chart，渐变填充）
  - 新增「Top 6 大表」列表（带横向进度条，可点击跳转 catalog）
  - 新增「脚本规模分布」卡片（按目录分组的进度条 + 总行数/总表数统计）
  - 行数趋势 Top 表加 hover 高亮
- 新增功能 4：SQL Playground 全面增强
  - 左侧表清单加搜索框（实时过滤 26 张表）
  - SQL 编辑器加语法高亮：
    * 关键字（SELECT/FROM/WHERE 等）紫色加粗
    * 字符串绿色、数字琥珀、操作符天蓝
    * 用「透明 textarea 覆盖高亮 pre 层」技巧实现可编辑高亮
    * 加行号显示
  - 结果表格列头可点击排序（升序/降序/取消，三态）
  - 结果分页（每页 8 行，前端分页）
  - 「导出 CSV」按钮
  - 保存查询改为内联对话框（替代 prompt()）
  - 字段参考显示 NN（非空）徽章，中文字段名红色警示
  - 状态栏显示字符数 / 行数
- 新增功能 5：血缘视图改造为交互式 SVG 图谱
  - 创建 27 个节点（6 外部源 + 21 表）+ 98 条边
  - 4 层布局：外部源 / L1 入库 / L2 计算 / L3 聚合
  - 节点可点击切换焦点，hover 高亮
  - 焦点表带紫色脉冲光环
  - 边用贝塞尔曲线，外部源边虚线
  - 高亮路径：focus 的上下游 N 层全部高亮，其他节点暗化
  - 缩放控制（50%-200%）+ 重置按钮
  - 右侧面板：焦点详情 + 上下游列表 + 用途说明
  - 底部图例：5 种节点颜色 + 高亮路径说明
- 新增功能 6：数据字典全面增强
  - 顶部 4 张统计卡：表总数 / 字段总数 / 中文列名数 / 可空字段数
  - 左侧表树新增「按表/按目录/按类型」三种分组 tab
  - 字段表新增搜索框（搜字段名/中文/类型）
  - 字段类型改为 Badge 样式（天蓝色描边）
  - 中文列名红色 + 「中文」徽章；非空字段加「NN」徽章
  - 表名可点击复制到剪贴板
  - 「导出 Markdown」按钮（生成 data_dictionary.md）
  - 底部新增「字段类型分布」卡片（按类型统计，带百分比）
- mock 数据扩展：
  - DAILY_STATS: 7 日执行汇总（含周末 0 行）
  - INGEST_TREND: 每日入座行数（含周末 0）
  - SCRIPT_DISTRIBUTION: 4 个目录的表数和代码行数
- 样式打磨：
  - 顶栏布局重构：搜索按钮 / 主题切换 / 铃铛 / 执行 daily / GitHub
  - KPI 卡片 hover 阴影 + sparkline
  - 节点 hover ring 效果
  - footer 升级 v2 标识
- 验证：
  - bun run lint 通过（0 error）
  - agent-browser 验证：
    * Dashboard：4 KPI+sparkline / 时间线 / 告警 / 环形图 / 区域图 / Top表 / 脚本分布 全部可见
    * 命令面板：Cmd+K 唤起，6 分组共 50+ 项，搜索 "kline" 过滤正确
    * 通知中心：铃铛打开，3 tab 切换，单条忽略工作
    * SQL 执行成功，结果 8 行，列头点击排序生效，导出 CSV 可用
    * 暗色模式切换无报错，SQL 高亮在暗色下清晰
    * 血缘 SVG：27 节点 98 边渲染，点击节点切换焦点
    * 数据字典：3 种分组切换，字段搜索过滤，类型分布显示
  - reload 后 console 0 error（修复了 v1 的 setState bug）
  - VLM 评分：Dashboard 8.5/10、Lineage 8/10、Dark SQL 9/10
  - 截图存档：download/v2-01 ~ v2-17 共 17 张

Stage Summary:
- 项目当前状态：稳定，功能显著扩展。从 v1 的 10 视图升级到 v2 的「10 视图 + 命令面板 + 通知中心 + 交互式血缘 + 增强 SQL/字典/Dashboard」
- 已完成的修改：
  1. 修复 React state update bug：theme-toggle 改 CSS-only 方案
  2. 命令面板 (Cmd+K)：6 分组 50+ 项，全站快捷搜索
  3. 通知中心：铃铛 + 抽屉，可忽略/筛选/跳转
  4. Dashboard 增强：Sparkline + 环形图 + 区域图 + Top 表 + 脚本分布
  5. SQL Playground 增强：表搜索 + 语法高亮 + 结果排序/分页 + CSV 导出
  6. 血缘 SVG 图谱：27 节点 98 边，交互式高亮
  7. 数据字典增强：3 种分组 + 字段搜索 + 类型徽章 + Markdown 导出
  8. lint 0 error，reload 后 0 console error
- 验证结果：所有交互（命令面板/通知中心/SQL 执行排序/血缘节点点击/字典分组切换）均工作正常

Unresolved / 下一阶段优先事项:
- 命令面板可加：最近搜索记录、命令历史、键盘快捷键提示
- 通知中心可加：WebSocket 实时推送、按表/规则分组、静音规则
- SQL Playground 可加：多 tab 查询、EXPLAIN 计划可视化、查询性能对比
- 血缘图谱可加：拖拽节点、minimap、按数据流方向自动布局
- 数据字典可加：版本对比（schema diff）、字段血缘（哪个脚本产出该字段）
- Dashboard 可加：实时执行流（WebSocket 推送）、按目录钻取、自定义 KPI
- 接真实 API（E3 阶段）仍是最大未完成项
- lint engine 12 条规则的 Python 实现仍未做（E1 阶段）
- 可加「执行实时进度条」mini-service（socket.io 端口 3003）演示实时日志推送

---
Task ID: 4 (cron webDevReview 第 3 轮)
Agent: main (Z.ai Code)
Task: DataOps 管理台持续开发巡检 — QA 测试 + 新增功能 + 样式打磨（v3）

Work Log:
- 读取 worklog.md 了解项目进展：v2 已完成 10 视图 + 命令面板 + 通知中心 + 交互式血缘 + 增强 SQL/字典/Dashboard + 实时日志流（log-streamer mini-service + useLogStreamer hook）
- 发现既有资产：mini-services/log-streamer/index.ts (322 行 socket.io server) + src/hooks/use-log-streamer.ts (272 行客户端模拟) + logs-view 已完整集成实时流
- QA 测试（agent-browser）：
  - dev server 正常 (port 3000, 200, 编译无错)
  - 10 视图遍历全部可访问，h1 标题全部正确
  - 命令面板：Cmd+K 唤起，60 命令，搜索 "kline" 过滤正确
  - 通知中心：铃铛打开抽屉正常
  - SQL 执行：成功，8 行结果，48ms，列头排序生效
  - 血缘：27 节点渲染，焦点高亮
  - 暗色切换：html class="dark" 生效
  - 执行详情抽屉：打开显示 run_id
  - reload 后遍历所有交互，0 console error
  - bun run lint 0 error
- 判断：项目稳定，无 bug 需修复，进入新功能开发
- 新增功能 1：Dashboard 实时执行流卡片
  - 复用 useLogStreamer hook，Dashboard 首页直接看实时执行
  - 左侧日志流（240px 高，自动滚动到底部，LIVE badge + 行数）
  - 右侧可触发剧本列表（8 个，点击触发实时执行）
  - 顶部：连接状态 badge + 当前运行 badge（表名+进度%）
  - 进度条：渐变色（sky→fuchsia→rose）
  - daily 全量进度条（amber）
  - 取消按钮 + 触发 daily + 完整日志跳转
  - 日志按级别着色：ERROR 红/WARNING 黄/INFO 绿/DEBUG 灰
- 新增功能 2：Lint 规则×表违规矩阵热力图
  - 12 规则 × ~13 目标 的矩阵表格
  - 单元格按违规数+规则级别着色：RED≥2 深红/RED 1 浅红/YELLOW 黄/BLUE 蓝/0 灰
  - 行头：规则 ID + 级别 badge + 名称（点击筛选下方规则列表）
  - 列头：表名（垂直书写，点击筛选）
  - Tooltip 悬停显示：规则 ID + 表名 + 违规数/通过
  - 行合计 + 列合计 + 总计（fuchsia 强调）
  - 图例：5 种颜色说明
  - 矩阵单元格 hover scale-110 + ring 效果
  - 清除筛选按钮（显示当前筛选状态）
- 新增功能 3：数据字典 Schema Diff 视图
  - 顶部 Tab 切换：字段视图 / Schema Diff（带变更数 badge）
  - 版本对比卡：v1.0 (当前) ↔ v0.9 (旧版)，含表数/字段数/作者/备注
  - 中间箭头 + 变更摘要卡（6 种变更类型计数）
  - 筛选栏：按变更类型（新增表/新增字段/重命名/类型变更/删除字段）+ 按表名下拉
  - 变更明细列表：变更类型 + 表 + 字段变更（旧名→新名 / 旧类型→新类型）+ 说明
  - 6 种变更类型：added_table/removed_table/added_col/removed_col/renamed_col/type_changed
  - 15 条 mock diff（含 R004 列名英化、capital_info 新增、volume 类型扩大等真实场景）
  - 每种类型独立配色（绿/红/黄/蓝）
- 样式打磨 1：命令面板底部快捷键提示栏
  - 3 个 kbd 键：↑↓ 导航 / ↵ 选择 / Esc 关闭
  - 右侧显示总项数（DataOps v3 · 60 项）
  - 浅灰背景 + 顶部 border 分隔
- 验证：
  - bun run lint 0 error
  - agent-browser 验证：
    * Dashboard 实时流：点击剧本触发，5 条日志实时推送，运行中 badge 显示，VLM 确认 LIVE 标记 + 日志内容正确
    * Lint 矩阵：12 行 × ~13 列渲染，单元格颜色区分级别，点击 R004 行头筛选规则列表，VLM 评分 8/10
    * Schema Diff：版本对比卡 + 变更摘要 + 明细列表，点击「重命名」筛选显示 9/15，VLM 评分 8/10
    * 命令面板 footer：3 个 kbd 提示 + 60 项计数
    * 暗色模式：新功能在暗色下视觉正常
    * reload 后遍历 10 视图 0 console error
  - 截图存档：download/v3-qa-* 共 14 张 + v3-final-* 共 4 张

Stage Summary:
- 项目当前状态：稳定，功能持续深化。v3 在 v2 基础上新增 3 大功能模块 + 1 项样式打磨，无新增 bug
- 已完成的修改：
  1. Dashboard 实时执行流卡片：首页即可触发/观察实时日志流，复用 useLogStreamer，含进度条/daily 全量/取消/剧本列表
  2. Lint 规则×表违规矩阵热力图：12×13 矩阵，5 级颜色，tooltip + 行列合计 + 点击筛选
  3. 数据字典 Schema Diff：版本对比 + 6 种变更类型 + 15 条 mock diff + 双重筛选
  4. 命令面板键盘快捷键 footer：↑↓/↵/Esc 提示 + 项数
  5. lint 0 error，reload 后 0 console error
- 验证结果：所有新功能交互正常（实时流触发/矩阵筛选/Schema Diff 筛选/命令面板 footer），VLM 评分 8/10

Unresolved / 下一阶段优先事项:
- SQL Playground 多 tab 查询（本轮未做，留作下阶段）
- 血缘图谱可加 minimap + 拖拽节点
- Dashboard 实时流可加：执行耗时统计、失败自动重试可视化
- Lint 矩阵可加：导出 CSV、规则修复进度跟踪
- Schema Diff 可加：三段版本对比、JSON 导出、字段血缘（哪个脚本产出该字段）
- 命令面板可加：最近搜索记录、命令历史
- 接真实 API（E3 阶段）仍是最大未完成项
- lint engine 12 条规则的 Python 实现仍未做（E1 阶段）
- log-streamer mini-service 当前用客户端模拟，可切回真实 socket.io（需保活机制）

---
Task ID: 5 (cron webDevReview 第 4 轮)
Agent: main (Z.ai Code)
Task: DataOps 管理台持续开发巡检 — QA 测试 + 修 bug + 新增功能 + 样式打磨（v4）

Work Log:
- 读取 worklog.md 了解 v3 进展：3 大功能（Dashboard 实时流/Lint 矩阵/Schema Diff）+ 命令面板 footer
- QA 测试（agent-browser）：
  - dev server 正常 (port 3000, 200)
  - 10 视图遍历全部可访问，0 console error
  - v3 功能验证：Dashboard 实时流触发成功（5 条日志）/ Lint 矩阵 12 行 / Schema Diff 15 处变更
  - reload 后遍历 0 error
  - bun run lint 0 error
- 判断：项目稳定，进入新功能开发
- 新增功能 1：SQL Playground 多 Tab 查询
  - 重构为 tabs 数组状态（QueryTab 接口：id/name/sql/result/running/durationMs/sortCol/sortDir/page）
  - 顶部 Tab 栏：active tab 有 sky 顶边 + 背景，hover 有 X 关闭按钮
  - Tab 状态图标：running 蓝脉冲圆点 / success 绿对勾
  - 新建 Tab 按钮（+ 图标）+ Ctrl+T 快捷键 + Ctrl+W 关闭
  - 双击 Tab 名重命名（内联 input，Enter 确认/Esc 取消）
  - 至少保留 1 个 tab（无法关闭最后一个）
  - 每个 tab 独立 sql/result/sort/page 状态
  - 状态栏新增 Ctrl+T/Ctrl+W 快捷键提示
  - 编辑器/结果标题显示当前 tab 名
- 修复 bug：血缘视图 Runtime TypeError
  - 根因：lucide-react 的 Map 图标覆盖了 JS 原生 Map 构造函数
  - lineage-view.tsx 的 nodeById useMemo 里 `new Map<string, GraphNode>()` 报错 "Map is not a constructor"
  - 修复：将 Map 导入重命名为 MapIcon，更新 2 处 JSX 引用
- 新增功能 2：血缘图谱 minimap + 拖拽节点
  - 拖拽：onNodeMouseDown/onSvgMouseMove/onSvgMouseUp 三阶段处理
  - 用 SVG createSVGPoint + getScreenCTM().inverse() 做坐标转换
  - nodeOverrides 状态记录移动后的位置，边界限制 (0..viewW-100, 40..viewH-40)
  - 节点 cursor-grab/grabbing + 拖拽时 drop-shadow + 已移动节点左上角 amber 圆点标记
  - 边用 getNodePos 动态计算起止点，拖拽时边跟随
  - Minimap 浮层（右上角 176×80）：缩略 SVG 显示所有节点+边，焦点节点 fuchsia 描边
  - Minimap 可隐藏/显示切换（X 按钮 / MapIcon 按钮恢复）
  - 底部拖拽提示栏（显示已移动节点数）
  - resetView 同时清空 nodeOverrides
- 新增功能 3：健康度视图增强
  - 7 日健康度趋势堆叠柱状图（success/failed/skipped/pending 四色堆叠）
  - 每柱顶部显示成功率%，底部日期，hover 颜色加深
  - 图例 + 7 日均成功率汇总
  - 按目录分布横条图（4 目录，绿/黄/红/灰四色分段 + 数量标注）
  - 矩阵新增按目录筛选（全部/入库/计算/策略/工具，筛选后行数变化）
  - 矩阵表头 flex-wrap 适配窄屏
- 样式打磨：全局滚动条 + 动画
  - globals.css 新增 @layer utilities：
    * Webkit 滚动条：8px 宽，圆角 thumb，hover 加深，dark 模式适配
    * Firefox：scrollbar-width: thin + scrollbar-color
  - card-enter 关键帧动画（translateY 8px → 0，0.3s）
  - pulse-glow 脉冲发光效果（用于实时状态）
  - cursor-grab/grabbing 光标类
- 验证：
  - bun run lint 0 error
  - agent-browser 验证：
    * SQL 多 Tab：1→2→3 个 tab，执行后 Tab 1 显示绿色对勾，结果 8 行，VLM 确认 3 tab + 状态图标 + 结果数据
    * 血缘：修复 Map bug 后 31 个 g 节点渲染，minimap 浮层显示，VLM 评分 8/10，无错误对话框
    * 健康度：7 根趋势柱 + 4 个目录横条，目录筛选 27→17 行（入库），VLM 确认全部组件
    * 暗色模式：新功能在暗色下正常
    * reload 后遍历 10 视图 0 console error
  - 截图存档：download/v4-qa-* 5 张 + v4-final-* 4 张

Stage Summary:
- 项目当前状态：稳定，功能持续深化。v4 在 v3 基础上新增 3 大功能 + 1 项样式打磨，修复 1 个 Runtime TypeError
- 已完成的修改：
  1. SQL Playground 多 Tab 查询：tabs 数组状态，新建/关闭/重命名，Ctrl+T/W 快捷键，状态图标
  2. 修复血缘 Map 命名冲突 bug：Map → MapIcon
  3. 血缘 minimap + 拖拽节点：SVG 坐标转换，nodeOverrides，drop-shadow，已移动标记
  4. 健康度增强：7 日堆叠柱状图 + 按目录横条图 + 矩阵容目录筛选
  5. 全局滚动条美化 + card-enter/pulse-glow 动画 + grab 光标
  6. lint 0 error，reload 后 0 console error
- 验证结果：所有新功能交互正常（多 Tab 增删/拖拽/minimap/目录筛选），VLM 评分 8/10

Unresolved / 下一阶段优先事项:
- SQL 多 Tab 可加：tab 持久化（localStorage）、跨 tab 结果对比、tab 拖拽排序
- 血缘可加：minimap 点击跳转、节点固定（pin）、自动布局算法
- 健康度可加：异常自动归因、补数任务编排、SLA 阈值配置
- Dashboard 可加：自定义 KPI 卡片、按时间范围切换
- 命令面板可加：最近搜索记录、tab 切换快捷键（Ctrl+Tab）
- 接真实 API（E3 阶段）仍是最大未完成项
- lint engine 12 条规则的 Python 实现仍未做（E1 阶段）
- log-streamer mini-service 当前用客户端模拟，可切回真实 socket.io

---
Task ID: 6 (cron webDevReview 第 5 轮)
Agent: main (Z.ai Code)
Task: DataOps 管理台持续开发巡检 — QA 测试 + 新增功能 + 样式打磨（v5）

Work Log:
- 读取 worklog.md 了解 v4 进展：10 视图 + 命令面板 + 通知中心 + 交互式血缘 + SQL 多 Tab + 健康度增强 + 全局滚动条/动画
- QA 测试（agent-browser）：
  - dev server 正常 (port 3000, 200, 编译无错)
  - 10 视图遍历全部可访问，H1 全部正确
  - 命令面板 Cmd+K 唤起，搜索 "kline" 过滤正确
  - 通知中心抽屉打开正常
  - SQL 多 Tab：3 个 tab，新建 tab，加载 q1 后执行返回 8 行
  - 血缘 27 节点 + minimap
  - 暗色切换正常
  - reload 后 0 console error
  - bun run lint 0 error
- 判断：项目稳定，进入新功能开发（重点：Settings 视图最弱，仅 150 行 readonly）
- 新增功能 1：Settings 视图全面重构（从 150 行 → 689 行）
  - 7 个 Tab：通用 / Lint 规则 / 调度 / 通知 / 数据源 / 集成 / 高级
  - 完整状态管理（SettingsState 接口 30+ 字段）
  - dirty state 跟踪：JSON 深比较，显示"未保存 · N 处变更"badge
  - Save/Reset/恢复默认 三按钮 + Ctrl+S 快捷键
  - Lint 规则配置：12 规则逐条 toggle + 级别覆盖（RED/YELLOW/BLUE 下拉）
  - 4 张级别统计卡（RED/YELLOW/BLUE/禁用）
  - 调度配置：时间输入 + 时区下拉 + Cron 表达式预览
  - 自动重试：可配置最大次数(0-10) + 退避间隔(5-300s) 滑块
  - 通知渠道：IM/邮件/Webhook 三选多卡片，条件展示收件人/URL 输入
  - 备份保留：滑块 7-180 天 + 预计磁盘占用计算
  - 高级：日志级别下拉 + 并行 worker(1-16) + 查询超时(30-3600s) 滑块
  - 密钥管理：3 个 key 行（已设置/未设置）
  - 危险区：清空缓存 / 重置所有配置
  - 集成 5 行：pre-commit / CI / WebSocket / REST API / 外部调度
  - 数据源 4 行：带延迟显示 + 巡检时间
- 新增功能 2：Dashboard 时间范围选择器（7d/30d/90d）
  - 顶部 segmented control：近 7 天 / 近 30 天 / 近 90 天
  - genScaledStats 函数：根据范围生成 N 天 mock 数据（周末 0，工作日基于日期 hash 的伪随机）
  - genScaledIngest 函数：生成 N 天入库行数趋势
  - KPI 卡片：成功率/入库行数/Sparkline 全部跟随范围
  - 环形图：{rangeLabel}执行成功率 + N 天 badge
  - 每日成功率横条：最多显示 12 天，超过显示"共 N 天"
  - 区域图：{rangeLabel}入座行数趋势 + 累计/日均/峰值
  - AreaChart 智能稀疏化：>30 隐藏圆点，>60 每 15 个标签，>20 每 7 个
- 新增功能 3：Logs 视图增强
  - 5 个级别 chips（全部/ERROR/WARNING/INFO/DEBUG）带计数 badge
  - chips 配色：激活时背景色填充，未激活时描边
  - 导出按钮：导出为 .log 文件（Blob + download）
  - 自动滚动开关：Switch + 底部跳转按钮
  - 日志行可展开/收起（>80 字符显示展开按钮）
  - 日志行可复制（hover 显示 Copy 按钮）
  - 移除级别下拉（改为 chips），保留表名下拉
  - LevelChip 子组件：5 色配色映射
- 新增功能 4：健康度异常自动归因
  - 重写"异常表详情"为"异常表自动归因"
  - getAttribution 函数：返回 severity/category/cause/fix/steps/lastError/retries/estimatedFix
  - 每张红表显示 3 列卡片：根因 / 下游影响 / 修复建议（红/黄/绿配色）
  - 修复步骤：编号圆点 + 步骤名 + 箭头连接
  - 底部元数据：最后出错时间 / 重试次数 / 预计修复时长
  - severity badge：CRITICAL（红）/ WARNING（黄）
  - category badge：实现缺失 / 配置矛盾 / 未知
  - 下游影响：显示下游表数量 + 前 2 个表名
- 新增功能 5：键盘快捷键帮助（? 键）
  - keyboard-help.tsx 组件（95 行）
  - ? 键全局唤起（忽略输入框中按键）
  - Dialog 展示 13 个快捷键，按 4 类分组（全局/设置/SQL/导航）
  - 每个快捷键：描述 + kbd 键位徽章
  - 顶栏新增 Keyboard 图标按钮入口
  - 支持受控/非受控两种模式（open/onOpenChange props）
- 新增功能 6：样式细节打磨
  - globals.css 新增 6 个动画/效果：
    * stagger-in：卡片依次入场（translateY + scale）
    * shimmer：加载骨架屏 shimmer 效果
    * slide-in-right：抽屉滑入
    * count-up：数字滚动入场
    * focus-ring：键盘焦点环
    * hover-lift：悬浮提升（translateY + shadow）
  - KpiCard 增强：hover -translate-y-0.5 + shadow + 图标 scale-110
  - 数字加 animate-count-up 入场
  - Settings 卡片 hover 过渡
- 修复 bug：Settings 视图 JSX 解析错误
  - 根因：template literal `${... ? '1-5' : '*'}` 中的 `* *` 被 JSX 解析器误判
  - 修复：移除 `state.dailyTime.length >= 4 ?` 三元，简化模板
- 验证：
  - bun run lint 0 error
  - agent-browser 验证：
    * Settings：7 tabs + 保存按钮 + Lint tab 12 规则行 + dirty state badge 切换
    * Dashboard：3 range buttons，30d 切换后显示"30日"，90d 显示"90 天"
    * Logs：5 level chips（全部17/ERROR2/WARNING1/INFO13/DEBUG1），ERROR 过滤后 2 条
    * Health：根因/修复步骤/异常表自动归因 全部可见
    * Keyboard help：? 键唤起 Dialog，显示"键盘快捷键"
    * reload 后 0 console error（仅 1 个已知 Dialog aria-description warning）
    * 10 视图遍历 H1 全部正确
  - 截图存档：v5-settings-general/lint/schedule, v5-dashboard-90d, v5-logs-enhanced, v5-health-attribution, v5-final-* 共 9 张

Stage Summary:
- 项目当前状态：稳定，功能显著扩展。v5 在 v4 基础上完成 Settings 视图全面重构 + Dashboard 时间范围 + Logs 增强 + 健康度归因 + 键盘帮助 + 样式动画，共 6 大功能模块
- 已完成的修改：
  1. Settings 视图重构（150→689 行）：7 Tab 交互式表单 + dirty state + Lint 规则配置 + Cron 预览 + 通知渠道 + 密钥管理 + 危险区
  2. Dashboard 时间范围选择器：7d/30d/90d segmented control + 数据缩放 + AreaChart 智能稀疏化
  3. Logs 视图增强：5 级别 chips + 导出 .log + 自动滚动开关 + 行展开/复制
  4. 健康度异常自动归因：3 列根因/影响/修复 + 步骤编号 + 元数据 + severity/category badge
  5. 键盘快捷键帮助（? 键）：13 快捷键 4 分类 Dialog
  6. 样式动画：stagger-in/shimmer/slide-in/count-up/focus-ring/hover-lift + KpiCard 增强
  7. lint 0 error，reload 后 0 console error

Unresolved / 下一阶段优先事项:
- Settings 可加：导入/导出 YAML 配置文件、配置版本历史、多环境 profile 切换
- Dashboard 可加：自定义 KPI 卡片、按表钻取、导出 PNG 报表
- Logs 可加：虚拟滚动（千条以上）、日志着色主题、按 run_id 分组
- 健康度可加：补数任务编排（多表批量 force）、SLA 阈值配置、自动修复脚本
- SQL Playground 可加：跨 Tab 结果对比、EXPLAIN 可视化、查询性能对比
- 命令面板可加：最近搜索记录、命令历史
- 血缘可加：minimap 点击跳转、节点 pin、自动布局算法
- 接真实 API（E3 阶段）仍是最大未完成项
- lint engine 12 条规则的 Python 实现仍未做（E1 阶段）
- log-streamer mini-service 当前用客户端模拟，可切回真实 socket.io

---
Task ID: 7 (cron webDevReview 第 6 轮)
Agent: main (Z.ai Code)
Task: DataOps 管理台持续开发巡检 — QA 测试 + 新增功能 + 样式打磨（v6）

Work Log:
- 读取 worklog.md 了解 v5 进展：10 视图 + 命令面板 + 通知中心 + 交互式血缘 + SQL 多 Tab + Settings 重构 + 键盘帮助 + 样式动画
- QA 测试（agent-browser）：
  - dev server 正常 (port 3000, 200, 编译无错)
  - 10 视图遍历全部可访问，H1 全部正确（用 ref 点击导航）
  - reload 后 0 console error（仅 React DevTools info + HMR）
  - VLM 分析 Dashboard/SQL 截图给出改进建议
  - bun run lint 0 error
- 判断：项目稳定，进入新功能开发
- 新增功能 1：SQL Playground 跨 Tab 结果对比
  - 结果卡片头新增「对比」按钮（fuchsia 描边，需 ≥2 个 tab 有结果才启用）
  - 全屏对比面板（max-w-6xl, max-h-90vh）：
    * 头部：渐变图标 + 标题 + 关闭按钮
    * Tab 选择器：左/右下拉选择对比的 tab（显示 tab 名+行数）
    * 统计 badge：相同(emerald)/差异(rose)/左独有(sky)/右独有(fuchsia)
    * 摘要条：Key 列 + 对比列 badge 列表 + 总行数
    * 对比表：key 列 sticky + 左值/右值并排 + 差异单元格红底高亮 + 状态 badge
    * 4 种行类型：match(绿)/diff(红)/left_only(蓝)/right_only(紫)
    * 底部图例 + 提示
  - 对比逻辑：取两结果交集列，首列做 key join，逐列比较值
  - 空状态：无结果时提示「请先在两个 Tab 中执行查询」
- 新增功能 2：Settings YAML 导入/导出
  - 顶部操作栏新增「导入」「导出」按钮 + 分隔线
  - 导出：生成 YAML 预览对话框（76 行）
    * 6 个 section：general/schedule/notification/backup/lint_rules(12规则)/advanced
    * 复制到剪贴板 + 下载 .yaml 文件
    * 渐变头部 + 行数统计
  - 导入：YAML 文本编辑对话框
    * 文件上传（.yaml/.yml/.txt）+ 文本框粘贴
    * 简易 YAML 解析器（支持 section/key-value/布尔/数字/数组/lint 子规则）
    * 浅合并到当前 state，toast 提示导入段数
    * placeholder 示例 + 格式说明
- 新增功能 3：命令面板最近搜索记录
  - localStorage 持久化（key: dataops:recent-searches, 最多 6 条）
  - 空搜索时顶部显示「最近搜索」分组
  - 每条记录：查询词 + 选中动作名 + 相对时间（刚刚/N分钟前/N小时前/N天前）
  - 点击最近搜索 → 填入搜索框
  - 「清除搜索历史」选项（rose 色）
  - 选中任意命令时记录当前搜索词
  - 打开时自动清空搜索 + 聚焦输入框
- 新增样式打磨：
  - globals.css 新增 8 个工具类/动画：
    * .text-gradient：标题渐变文字（sky→fuchsia）
    * .bg-grid-pattern：细网格背景（明暗适配）
    * .glow-ring：活跃元素发光环
    * .animate-fade-in / .animate-scale-fade-in：淡入/缩放淡入
    * .animate-flash：新数据闪烁高亮
    * .toolbar-divider：工具栏竖分隔线（16px）
    * .row-hover-gradient：行 hover 左侧渐变条
  - page.tsx 应用：
    * 根 div 加 bg-grid-pattern 网格背景
    * 顶栏 backdrop-blur-sm 半透明
    * 页面标题 text-gradient 渐变文字
    * 视图切换 animate-fade-in + key={view} 触发重新动画
  - SQL 编辑器工具栏加 toolbar-divider（VLM 建议）
- 修复 bug：lucide-react NotEqual 图标不存在
  - 根因：import { NotEqual } 报 "Export NotEqual doesn't exist in target module"
  - 修复：改用 Split 图标（2 处：统计 badge + 行状态 badge）
- 验证：
  - bun run lint 0 error
  - agent-browser 验证：
    * SQL 跨 Tab 对比：tab1 执行(stock_daily_kline 8行) + tab2 执行(COUNT 3行) → 点对比 → 面板打开，统计 0相同/0差异/8左独有/3右独有，VLM 确认布局合理
    * Settings YAML 导出：点导出 → 预览面板 76 行，含 general/schedule/notification/backup/lint_rules(12)/advanced 全部 section，复制/下载按钮可见
    * 命令面板最近搜索：搜 "kline" → 选中 stock_daily_kline → 重开 → 顶部「最近搜索」显示 "kline → stock_daily_kline · 刚刚" + 清除按钮
    * 暗色模式：VLM 8/10，渐变标题/网格背景/卡片效果均正常
    * reload 后 0 console error
  - 截图存档：download/v6-qa/ 共 15 张（01~12 含 dark mode）

Stage Summary:
- 项目当前状态：稳定，功能持续扩展。v6 在 v5 基础上新增 3 大功能模块 + 8 项样式工具类，修复 1 个图标导入 bug
- 已完成的修改：
  1. SQL 跨 Tab 结果对比：全屏面板，key join + 差异高亮 + 4 种行类型 + 统计 badge
  2. Settings YAML 导入/导出：76 行 YAML 预览 + 复制/下载 + 文件上传/粘贴导入 + 简易解析器
  3. 命令面板最近搜索：localStorage 持久化 + 相对时间 + 清除历史
  4. 样式打磨：8 个 CSS 工具类（text-gradient/bg-grid-pattern/glow-ring/fade-in/scale-fade-in/flash/toolbar-divider/row-hover-gradient）
  5. page.tsx 视觉升级：网格背景 + 半透明顶栏 + 渐变标题 + 视图切换动画
  6. SQL 编辑器工具栏分隔线
  7. 修复 lucide NotEqual → Split
  8. lint 0 error，reload 后 0 console error
- 验证结果：所有新功能交互正常（对比面板/YAML 导出导入/最近搜索），VLM 评分 8/10

Unresolved / 下一阶段优先事项:
- SQL 对比可加：导出对比结果为 CSV/HTML、三 Tab 对比、按列对齐 diff（非 key join）
- Settings YAML 可加：多环境 profile 切换（dev/staging/prod）、配置版本历史、YAML 语法校验高亮
- 命令面板可加：命令历史导航（↑↓ 切换历史搜索）、置顶常用命令、按使用频率排序
- 血缘图谱可加：minimap 点击跳转、节点 pin、自动布局算法
- Dashboard 可加：自定义 KPI 卡片、按表钻取、导出 PNG 报表
- Logs 可加：虚拟滚动（千条以上）、日志着色主题、按 run_id 分组
- 接真实 API（E3 阶段）仍是最大未完成项
- lint engine 12 条规则的 Python 实现仍未做（E1 阶段）
- log-streamer mini-service 当前用客户端模拟，可切回真实 socket.io

---
Task ID: 8 (cron webDevReview 第 7 轮)
Agent: main (Z.ai Code)
Task: DataOps 管理台持续开发巡检 — QA 测试 + 新增功能 + 样式打磨（v7）

Work Log:
- 读取 worklog.md 了解 v6 进展：10 视图 + SQL 对比 + YAML 导入导出 + 命令面板最近搜索 + 8 个 CSS 工具类
- QA 测试（agent-browser）：
  - dev server 正常 (port 3000, 200)
  - 10 视图遍历全部可访问，0 console error
  - bun run lint 0 error
- 判断：项目稳定，进入新功能开发（3 大新功能并行开发）
- 新增功能 1：Dashboard KPI 钻取交互
  - KpiCard 组件新增 onClick/popover/navigable 3 个可选 props
  - 数据表总数 → 点击跳转健康度视图
  - 执行成功率 → Popover 弹出 7 日成功率明细表（日期/成功·总数/率%）
    * 颜色编码：100% 绿、≥90% 琥珀、<90% 红
    * 底部「点击查看更多 → 编排」链接
  - 入库行数 → Popover 弹出 Top 5 大表列表（fuchsia 进度条）
    * 底部「点击查看更多 → 目录」链接
  - 待处理告警 → 点击跳转规范校验视图
  - 视觉：cursor-pointer + focus-visible ring + ArrowUpRight 悬浮图标
  - Popover 使用 shadcn Popover + animate-scale-fade-in 入场
- 新增功能 2：Logs 按 run_id 分组 + 虚拟滚动
  - groupByRun 布尔状态 + 「按执行分组」切换按钮（Layers 图标）
  - 活跃时显示分组数 badge（10 组）
  - 分组逻辑：按日期前缀 + 表名 + 时间间隔（>10min 分组）
  - 分组头：ChevronDown/Right 折叠 + Run ID mono + 状态点(红/黄/绿)
    * 错误组自动展开，正常组默认折叠
    * 左边框颜色：error=rose / warning=amber / clean=emerald
  - 虚拟滚动：仅渲染可视区域 + 20 行缓冲（二分查找定位）
  - 日志行改进：级别左边框色 + row-hover-gradient + "Copied!" 1.5s 提示
- 新增功能 3：编排视图 Gantt 执行时序图
  - SVG 甘特图，位于执行历史上方
  - 标题：「执行时序图」+ Activity 图标 + 时间跨度副标题
  - 时间轴：10 分钟间隔标签（17:00, 17:10...）+ 虚线网格
  - 条形：success=emerald / failed=rose / running=sky+动画 / skipped=zinc
  - 表名标签 + 时长标签 + 圆角 + 最小 2% 宽度
  - 交互：hover 高亮 + 亮度提升 + tooltip(表名/状态/起止/时长/行数) + 点击打开 RunDetailSheet
  - 运行中条形动画渐变 + 失败条形末尾白点指示
  - 图例：4 色状态点
- 样式打磨：
  - 侧栏重构：
    * 背景：bg-white/80 backdrop-blur-sm 半透明
    * 圆角：rounded-md → rounded-lg
    * 活跃项：左侧 3px 渐变指示条(sky→fuchsia) + shadow-sm
    * 非活跃项：hover:translate-x-0.5 微右移
    * 图标：活跃时 scale-110 + transition-transform
    * 徽章：活跃时 scale-105
  - 页脚升级：
    * backdrop-blur-sm 半透明
    * v7 Badge 徽章
    * 新功能标签：Gantt 时序 · KPI 钻取 · 日志分组 · YAML 导入导出
    * 数据库连接状态点(sky)
- 修复 bug：Badge 未导入
  - page.tsx footer 使用了 Badge 但未 import
  - 修复：添加 `import { Badge } from '@/components/ui/badge'`
- 验证：
  - bun run lint 0 error
  - agent-browser 验证：
    * KPI 钻取：点击「数据表总数」→ 跳转健康度；点击「执行成功率」→ Popover 打开显示 7 日明细表 + 编排链接
    * 日志分组：点击「按执行分组」→ 显示 10 个 run_id 分组 + 折叠/展开
    * Gantt 时序图：编排视图渲染 SVG 甘特图，时间轴 17:00~19:40，条形按状态着色
    * 侧栏：活跃项左侧渐变指示条，VLM 确认可见
    * VLM 评分：Gantt 8/10, Dashboard 8/10
    * reload 后 0 console error
  - 截图存档：download/v7-qa/ 共 6 张

Stage Summary:
- 项目当前状态：稳定，功能持续深化。v7 在 v6 基础上新增 3 大功能模块 + 侧栏/页脚视觉升级
- 已完成的修改：
  1. Dashboard KPI 钻取：4 张卡片 3 种交互（2 跳转 + 2 Popover），7 日成功率明细 + Top 5 大表
  2. Logs run_id 分组：10 组 + 折叠/展开 + 虚拟滚动 + 级别左边框 + row-hover-gradient
  3. 编排 Gantt 时序图：SVG 甘特图 + 时间轴 + 状态着色 + tooltip + 点击打开详情
  4. 侧栏视觉升级：渐变指示条 + 半透明背景 + hover 微位移 + 图标缩放
  5. 页脚升级：v7 badge + 新功能标签 + 半透明背景
  6. 修复 Badge import 缺失
  7. lint 0 error，reload 后 0 console error
- 验证结果：所有新功能交互正常，VLM 8/10

Unresolved / 下一阶段优先事项:
- KPI Popover 可加：入库行数按表钻取（跳转 catalog 并自动选中表）
- Gantt 可加：拖拽调整时间范围、并行度热力图、对比多日执行
- 日志分组可加：按 run_id 搜索、组内全选/全展开、分组导出
- 侧栏可加：折叠/展开动画、拖拽排序、自定义快捷方式
- Dashboard 可加：告警趋势图、执行耗时分布直方图
- Catalog 可加：表依赖关系图、批量操作、schema 变更时间线
- 接真实 API（E3 阶段）仍是最大未完成项
- lint engine 12 条规则的 Python 实现仍未做（E1 阶段）

---
Task ID: 9
Agent: main (Z.ai Code)
Task: 离线免端口模式 + 用户使用流程文档

Work Log:
- 用户需求：线下能不依赖端口浏览器打开？写用户使用流程在 0_weihuxiezuo
- 修改 next.config.ts：添加 BUILD_MODE 环境变量支持
  - `BUILD_MODE=export` → `output: "export"` + `images.unoptimized` + `assetPrefix: "./"`
  - 默认仍为 `output: "standalone"`（开发模式不受影响）
- 删除占位 API 路由 (`src/app/api/route.ts`)，因与静态导出不兼容且应用未使用
- 添加 package.json 脚本：
  - `build:static` → `BUILD_MODE=export next build`（生成 out/ 目录）
  - `preview:static` → `bunx serve out -p 8080`（本地 HTTP 预览）
- 构建验证：`BUILD_MODE=export next build` 成功，生成 out/ 目录（1.8MB）
  - 所有资源路径为相对路径 `./`，支持 file:// 协议直接打开
  - 字体文件已打包（Geist Sans/Mono woff2）
- 创建 `db_scripts_analysis/0_weihuxiezuo/` 目录：
  - `用户使用流程.md`：完整用户指南（9 章：快速开始/首次构建/功能导航/快捷键/核心功能/模式对比/目录结构/FAQ/更新日志）
  - `start-dataops.bat`：Windows 一键启动脚本
  - `start-dataops.sh`：macOS/Linux 一键启动脚本
- 验证：HTTP 服务返回 200 OK，HTML 内容完整；lint 0 error；开发模式正常

Stage Summary:
- 项目当前状态：稳定，新增离线免端口能力
- 已完成的修改：
  1. next.config.ts 支持静态导出模式（BUILD_MODE=export）
  2. 删除占位 API 路由
  3. 新增 build:static / preview:static 脚本
  4. 创建 0_weihuxiezuo 目录（用户使用流程.md + 启动脚本）
  5. 静态导出 1.8MB，支持双击 index.html 直接打开
- 验证结果：静态构建成功，HTTP 200 OK，lint 0 error

Unresolved / 下一阶段优先事项:
- 双击 file:// 打开时，部分浏览器可能限制 JS 执行（Chrome 需启用 file access flag）
- 可制作独立 ZIP 分发包（dataops-offline.zip）
- 可考虑 Electron/Tauri 封装为桌面应用

---
Task ID: 10
Agent: main (Z.ai Code)
Task: 创建独立 UI 界面（用户要求有单独的 UI 界面，不依赖端口）

Work Log:
- 用户澄清需求：要有单独的 UI 界面，而非仅配置文件层面的静态导出
- 将 out/ 静态导出复制到 0_weihuxiezuo/dataops-ui/ 作为独立交付物
- 添加 favicon.svg 避免离线访问 404 错误
- 重写启动脚本（start-dataops.bat / .sh），指向 dataops-ui/ 目录
- 更新用户使用流程文档，强调"独立 UI 界面"概念
- agent-browser 验证：静态导出通过 HTTP 服务访问，10 视图全部正常渲染和交互
- 静态导出 1.8MB，可拷贝到任何电脑直接打开

Stage Summary:
- 项目当前状态：稳定，独立 UI 界面已完成
- 已完成的修改：
  1. dataops-ui/ 目录（1.8MB 独立界面包，双击 index.html 即可打开）
  2. 启动脚本更新（指向 dataops-ui/）
  3. favicon.svg 添加
  4. 用户使用流程文档重写（强调独立 UI + 3 种打开方式 + 浏览器兼容表）
- 验证结果：静态导出通过 agent-browser 验证，10 视图全部可交互

Unresolved / 下一阶段优先事项:
- Chrome 双击 file:// 可能空白，需 HTTP 服务或 Edge/Firefox
- 可制作 ZIP 分发包
- 可考虑 Electron/Tauri 桌面应用封装
