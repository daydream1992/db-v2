# DataOps 管理台

基于 Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS 4 + shadcn/ui 的 DataOps 管理台 UI 原型。

## 快速开始

```bash
# 安装依赖
bun install

# 配置环境
cp .env.example .env.local

# 启动开发
bun run dev

# 打开浏览器
# http://localhost:3000
```

## 功能

- **10 个视图**: Dashboard / 脚本目录 / 健康度 / 编排 / 血缘 / 规范校验 / 日志 / 数据字典 / SQL Playground / 设置
- **12 条 Lint 规则**: 可导出 Python linter 脚本
- **GitHub 同步**: 自动拉取/推送元数据
- **暗色模式**: next-themes 支持
- **命令面板**: Cmd+K 快速导航
- **实时通知**: 多类型告警推送
- **SQL EXPLAIN 可视化**: 树图 + 文本视图
- **多环境 Profile**: 开发/测试/生产配置切换

## 技术栈

- Next.js 16 (App Router)
- React 19 + TypeScript 5
- Tailwind CSS 4 + shadcn/ui
- Prisma + SQLite (沙箱) / DuckDB (本地)
- Zustand + TanStack Query
- framer-motion + socket.io
