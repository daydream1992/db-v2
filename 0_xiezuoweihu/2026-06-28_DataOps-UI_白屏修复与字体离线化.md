# DataOps-UI 白屏修复 + 字体离线化

| 项目 | 内容 |
|------|------|
| 日期 | 2026-06-28 |
| 范围 | `dataops-ui/`（Next.js 16.2.9 + Turbopack） |
| 维护人 | daydream1992 |
| 影响 | 前端管理台首页可正常渲染；去掉外网字体依赖，冷启动提速 |

---

## 1. 接入时间线（按时间顺序）

> 记录从环境初始化到问题修复的完整过程，含踩坑与误判，便于协作者复盘环境与工具链行为。

### ① 环境初始化
- 给定接入命令：`cd dataops-ui` → `bun install` → `cp .env.example .env.local` → `bun run dev`。
- 首次尝试把 `bun install` 与 `cp .env.local` 串成一条命令执行 → **被中断/拒绝**。
- 改为分步：`bun install`（873 包，无变更，744ms）+ `cp .env.example .env.local`（1634 字节）→ 成功。

### ② 启动 dev server（后台任务 cwd 踩坑）
- **第 1 次后台启动** `cd dataops-ui && bun run dev` → **失败**：
  ```
  /usr/bin/bash: line 1: cd: dataops-ui: No such file or directory
  ```
  原因：前一步 `cd dataops-ui && bun install` 已把 shell 工作目录切进 `dataops-ui`，再相对 `cd dataops-ui` 等于查找 `dataops-ui/dataops-ui`（不存在）。
- **第 2 次后台启动** `bun run dev`（去掉 cd）→ **成功**，Next.js 16.2.9 `Ready in 579ms`。原因：工作目录此时已在 `dataops-ui`。
- **教训**：前台 `cd` 会持久改变后台任务继承的 cwd；后台长任务启动时不要再相对 cd，必要时用绝对路径。

### ③ 发现白屏
- 浏览器打开 `http://localhost:3000/` → **整页白屏**。
- `curl` 返回 HTTP 200，SSR 产出 121KB / 约 2354 字符可见文本 → 判定**非服务端渲染问题**，锁定客户端 hydration 阶段。

### ④ 定位根因（读 dev server 日志）
日志同时暴露三类信号：
- `[browser] Hydration failed ... +26300 / -26301` → **白屏直接原因**。
- `Encountered a script tag while rendering React component` → warning，非阻塞。
- `Failed to download Geist Mono from Google Fonts`（外网字体失败，冷编译 38~75s）。

随后 `grep "Math.random|Date.now|new Date()"` 全仓扫描，定位到 [`dashboard-view.tsx`](../dataops-ui/src/components/dataops/dashboard-view.tsx) 的「已运行 Xs」在 render 期调用 `Date.now()`。

### ⑤ 修复白屏（dashboard-view.tsx）
- 3 处编辑：新增 `runningElapsed` state、新增 `useEffect` ticker、替换 render 期 `Date.now()` 表达式。
- 验证：重编译 113ms，日志**无** hydration 报错。

### ⑥ 字体离线化（用户确认后执行）
- `bun add geist@1.7.2`。
- [`layout.tsx`](../dataops-ui/src/app/layout.tsx) 2 处编辑：换 import、换 `<body>` className。
- HMR 切换瞬间出现一次 `geistSans is not defined`（旧 chunk 仍引用被删变量），Fast Refresh full reload 后自动恢复，属正常热更新过渡。
- 验证：首页 HTML 中 `googleapis` 出现 0 次，body 改用本地 geist 字体模块。

### ⑦ 输出维护文档
即本文件，落盘到 `0_xiezuoweihu/` 供 GitHub 协作。

---

## 2. 背景

为 `dataops-ui` 接入本地运行环境后，浏览器打开 `http://localhost:3000/` 出现**整页白屏**。服务端日志返回 HTTP 200 且 SSR 产出 121KB / 约 2354 字符的可见文本，说明问题出在客户端 hydration 阶段，而非服务端渲染失败。

启动步骤（供协作者复现）：

```bash
cd dataops-ui
bun install
cp .env.example .env.local
bun run dev   # 默认监听 http://localhost:3000
```

---

## 3. 根因分析

排查中发现**两个独立问题**，均与白屏/启动卡顿相关。

### 3.1 问题一：hydration 不匹配导致整树丢弃（白屏直接原因）

**报错（dev server 日志）：**

```
[browser] Uncaught Error: Hydration failed because the server rendered text didn't match the client.
  ...
  <DashboardView>
    <Card className="lg:col-span-2">
      <CardContent>
        <div className="mb-3 p-2 r...">
          <span>...</span><span>...</span><span>...</span>
          <span className="text-zinc-...">
+           -26300        ← 客户端首次渲染
-           -26301        ← 服务端渲染
```

**定位：** [`src/components/dataops/dashboard-view.tsx`](../dataops-ui/src/components/dataops/dashboard-view.tsx)（改动前）「运行中」状态条里的「已运行 Xs」计数：

```tsx
<span ...>force={String(runningRun.force)} · 已运行 {Math.floor((Date.now() - new Date(runningRun.startedAt).getTime()) / 1000)}s</span>
```

**原因：** render 期直接调用 `Date.now()`。服务端渲染时刻 T1（如 26301s）与客户端 hydration 时刻 T2（26300s）差 1 秒 → 同一节点文本不一致 → React 抛弃整棵客户端树 → 白屏。报错栈精确指向该 `runningRun` 区块（3 个 span + 计数 span），与现象完全吻合。

### 3.2 问题二：Google Fonts 拉取失败（启动卡顿 + 日志刷屏）

**报错（每次请求重复出现）：**

```
⚠ next/font: warning:
Failed to download `Geist Mono` from Google Fonts. Using fallback font instead.
Error while requesting resource
There was an issue establishing a connection while requesting
https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap
```

**影响：**
- 本机无法访问 `fonts.googleapis.com`，Turbopack 每次编译都重试（带超时），导致**冷编译耗时 38~75 秒**（增量编译已缓存时 ~100ms）。
- 虽然触发了 fallback 字体、**不是**白屏的直接原因，但严重影响开发体验并持续刷屏。

**定位：** [`src/app/layout.tsx`](../dataops-ui/src/app/layout.tsx) 使用了 `next/font/google` 的 `Geist` / `Geist_Mono`。

---

## 4. 改动详情

### 4.1 修复 hydration 不匹配（dashboard-view.tsx）

把 render 期的 `Date.now()` 计数改为 **state 驱动的 ticker**：

```tsx
const [runningElapsed, setRunningElapsed] = useState(0)

useEffect(() => {
  if (!runningRun) return
  const startedAtMs = new Date(runningRun.startedAt).getTime()
  const tick = () => setRunningElapsed(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)))
  tick()
  const id = setInterval(tick, 1000)
  return () => clearInterval(id)
}, [runningRun])
```

渲染处：

```tsx
<span ...>force={String(runningRun.force)} · 已运行 {runningElapsed}s</span>
```

**为什么有效：**
- 初始 state `0` → 服务端与客户端首次渲染**完全一致**（都是「已运行 0s」），消除 hydration 不匹配。
- `useEffect` 挂载后才计算真实值并每秒 tick → 不影响首屏 hydration，且比原来多了「实时跳动」的效果。

### 4.2 字体离线化（layout.tsx + 新增依赖）

改用官方 `geist` 包（自带 woff2 字体文件，`next/font/local` 封装，**完全离线**，视觉与原 Geist 一致）：

```bash
bun add geist   # geist@1.7.2
```

```tsx
// layout.tsx —— 改动前
import { Geist, Geist_Mono } from "next/font/google";
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// layout.tsx —— 改动后
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
// <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased bg-background text-foreground`}>
```

> `geist` 包默认暴露的 CSS 变量名就是 `--font-geist-sans` / `--font-geist-mono`，与现有 `globals.css` / tailwind 配置无缝衔接，无需改其它文件。

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `dataops-ui/src/components/dataops/dashboard-view.tsx` | 新增 `runningElapsed` state + `useEffect` ticker；替换 render 期 `Date.now()` 表达式 |
| `dataops-ui/src/app/layout.tsx` | `next/font/google` → 本地 `geist` 包；删除两个字体常量声明 |
| `dataops-ui/package.json` | 新增依赖 `geist@1.7.2` |

---

## 5. 验证结果

| 检查项 | 结果 |
|--------|------|
| `curl http://localhost:3000/` | HTTP 200 |
| 首页 hydration | 重编译后日志**无** `[browser] Hydration failed`，页面正常渲染 |
| Google Fonts 依赖 | 首页 HTML 中 `googleapis` 出现次数 = **0** |
| body 字体 class | `geistsans_..._variable geistmono_..._variable`（本地字体模块） |
| 增量编译耗时 | ~100ms（无字体重试） |

---

## 6. 复现 / 回滚

**复现白屏（回退 4.1 改动）：** 把 dashboard-view.tsx 的「已运行」改回 `Math.floor((Date.now() - new Date(runningRun.startedAt).getTime()) / 1000)`，刷新页面即可复现 hydration 报错与白屏。

**回退字体（不推荐）：** 删除 `geist` 依赖、layout.tsx 改回 `next/font/google`，会重新引入外网依赖与冷编译卡顿。

---

## 7. 协作约定（给后续维护者）

1. **render 期禁止调用 `Date.now()` / `new Date()` / `Math.random()`**：任何随时间/随机变化的值都不能出现在组件 render 体里，否则必触发 hydration 不匹配。需要「实时」的值（如运行时长、相对时间），一律用 `useState` 初值固定 + `useEffect` 更新。
2. **新增 Google Fonts 等外网依赖前先确认网络**：内网/受限环境拉取失败会拖慢编译。优先使用本地字体包（`geist` / `next/font/local`）。
3. **诊断白屏的第一步**：看 dev server 日志里的 `[browser]` 段 + React hydration diff（会精确标出 `+client / -server` 的不一致节点）。
4. **后台任务启动别再相对 cd**：前台 `cd` 已改变 cwd，后台任务直接用当前目录或绝对路径，避免 `cd: ... No such file or directory`。
