---
Task ID: 1
Agent: main (Z.ai Code)
Task: DB数据库_v2 脚本库系统化方案探索 — 产出设计文档 + UI 管理台原型

Work Log:
- 系统性通读脚本包：CLAUDE.md / dbv2-skeleton.md / run.py 全文 / 1_入库·2_计算·3_策略·4_工具 全部脚本 / 废弃目录
- grep 量化统计：DB_PATH 硬编码 49 处、TQ 初始化重复 9 份、5 种 fetch_data 签名变体
- 产出诊断报告 SCRIPT_AUDIT_REPORT.md：8 类核心问题 + 3 档解决方案 + 8 个确认 bug
- 产出系统化方案探索文档 SYSTEM_DESIGN_EXPLORATION_v1.md：
  - 三层架构（治理/执行/观测）
  - YAML registry SSOT + 12 条可机器校验 lint 规则
  - BaseIngest 基类 + 执行状态机 + orchestrator
  - 9 个 UI 页面信息架构
  - 从入库到调用全流程
  - 与现有 run.py 的演进关系（不推翻）
  - 5 阶段落地路线图 (E0-E5)
- 搭建 Next.js UI 原型（frontend-first，mock 数据基于真实 26 个脚本清单）：
  - mock-data.ts：26 个表完整元数据 + 12 条 lint 规则 + 15 条执行记录 + 8 条告警 + 健康度矩阵 + 行数趋势
  - styles.ts：颜色/格式化辅助
  - 9 个视图组件：dashboard / catalog / health / orchestration / lineage / lint / logs / dictionary / settings
  - page.tsx：侧栏导航 + 视图切换 + sticky footer + 执行 daily 按钮 + toast 反馈
- 自检：
  - bun run lint 通过（0 error）
  - dev server 运行正常 (port 3000)
  - agent-browser 验证：9 个视图全部可切换、Catalog 详情抽屉可打开、触发执行 toast 正常、健康度矩阵 7×26 渲染、lint 12 规则显示、移动端 375px 无水平滚动、sticky footer 行为正确
  - 无运行时错误，仅 1 个 shadcn Dialog aria-description warning（非阻断）

Stage Summary:
- 交付物：
  1. /home/z/my-project/db_scripts_analysis/SCRIPT_AUDIT_REPORT.md （诊断报告）
  2. /home/z/my-project/db_scripts_analysis/SYSTEM_DESIGN_EXPLORATION_v1.md （系统化方案探索 v1）
  3. /home/z/my-project/src/app/page.tsx + 9 个视图组件 + mock 数据 （UI 原型，可交互）
- 核心设计决策：不重写 run.py，而是套「治理壳 + 可视化壳」；YAML registry 替代散落 @meta；lint engine 把人记规范变机器校验；BaseIngest 统一 5 种签名
- UI 原型覆盖 9 个页面，数据全部基于真实脚本清单（26 表 + 8 bug + 12 lint 规则），让用户看到的是项目真实样貌
- 待用户决策的 5 个点：废弃脚本处理 / 中文列名是否保留 / BaseIngest vs 平铺 / DB_PATH 统一 / run.py 拆分
- 下一步：等用户对方案方向反馈，决定是否进入 E1（YAML registry + lint engine 真实实现）

Unresolved / Risk:
- UI 为纯 mock，未接真实 DuckDB / run.py（E3 阶段任务）
- lint engine 12 条规则是设计稿，尚未实现 Python 版
- BaseIngest 基类未实现，26 个脚本未迁移
- 血缘 DAG 当前是静态分层展示，未接 react-flow 交互式图谱（P2）
