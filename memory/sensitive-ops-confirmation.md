---
name: sensitive-ops-confirmation
description: 敏感操作必须先征得用户确认
metadata:
  type: pattern
---

敏感操作超出用户明确指令范围时，必须先征得用户确认再动手。

**范围：**
- 扩展字段/列（如入库脚本加展开列）
- 改变数据存储方式（如删 JSON）
- 修改表结构（ALTER TABLE）
- 改变 MODE（increment ↔ full）
- 改动涉及已有数据
- 重写函数架构（生成器/batch 等）
- 删代码（函数或代码块）

**Why:** 防止自作主张，用户只说"入库"，不能自行扩展字段、改结构。本会话中踩过坑：入库 fact_finance_report 时主动加34列、改MODE、删JSON、重构fetch_data/save_data，全都没问。
**How to apply:** 遇到以上情况，先说"要改X，符合Y操作，需要确认"再动手。