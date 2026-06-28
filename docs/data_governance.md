# 数据治理工作流手册

> 这是项目「增删表 / 读写 / 内存 / 协作」的操作规范。
> **模型干活前必读，用户照此验收。** 配套命令见末尾速查。

---

## 一、交互协议（模型 ↔ 用户都懂的契约）

### 模型侧（我）必须遵守
1. **接续先读** `dbv2-skeleton.md` + `config/data_dictionary.json`（SSOT），再动手
2. **动表前先报方案**：任何 CREATE/DROP/ALTER/改@meta，先列「改什么、影响哪些表、内存预估」给用户确认
3. **不编造表名列名**：写 SQL 前先 `DESCRIBE` 或查 data_dictionary.json 确认
4. **改完即同步**：动表后立刻 `python run.py sync-dict` + `python run.py integrity`，把结果贴给用户
5. **错误如实报**：脚本失败/跳过/数据为空，原样说，不粉饰

### 用户侧（你）验收清单
每次模型说「完成」，对照 3 条：
- [ ] `python run.py integrity` 是否 `RED=0 YEL=0 BLU=0`？（一致性）
- [ ] `docs/data_dict.md` 是否更新？（字典同步）
- [ ] git 是否 commit？（可追溯）

不满足任意一条 = 没做完。

---

## 二、增删表规范

### 新增表（4 步，顺序不可乱）
```
1. 写脚本 1_入库/XX_name.py 或 2_计算/XX_name.py
   - 头部必须 @meta table=xxx cn=xxx dir=xxx sort=xxx schedule=xxx mode=xxx source=xxx
   - 含 ensure_table / fetch_data / save_data / run(force) 四件套
2. 跑一次入库验证数据正确
3. python run.py sync-dict      # 字典登记
4. python run.py integrity      # 确认 0 异常
```

### 删除表（3 步）
```
1. python -c "import duckdb; duckdb.connect('db/...').execute('DROP TABLE xxx')"
2. 删脚本（或移到 废弃/ 目录，run.py 不扫子目录）
3. python run.py sync-dict && python run.py integrity  # 确认无孤儿残留
```

### 命名规范（强规）
| 类型 | 格式 | 例 |
|------|------|-----|
| 脚本 | `{3位sort}_{table}.py` | `93_stock_gp1_46_indicators.py` |
| 表名 | 小写下划线，**禁数字开头**（DuckDB） | `stock_daily_kline` |
| 视图 | `{table}_labeled` | `stock_gp1_46_indicators_labeled` |
| 维度表 | `dim_{领域}_indicator` | `dim_gp_indicator` |
| 例外 | 仅 101 一例 `jb_` 前缀（表名剥前缀） | — |

### 字段含义放哪（三层优先）
1. 脚本内 `FIELD_MAP` 字典（ast 可被生成器自动采集）← **首选**
2. `dim_*_indicator` 维度表（枚举值含义）
3. 拿不到 → 字典标 `TODO`，逐步补

---

## 三、读写规范

### 读（查询）
- **先 DESCRIBE 确认列名再写 SQL**，不凭记忆
- 大表（>千万行）查询必须加 `date`/`code` 过滤，禁止 `SELECT *` 全扫
- 调试用 `LIMIT`，确认逻辑后再跑全量

### 写（入库）
- **强制走标准模板**：`ensure_table` + `fetch_data` + `save_data` + `run(force)`
- **增量模式**：先 `DELETE WHERE date IN (...)` 再 INSERT（按日期删，不按 code 全删）
- **全量模式**：`DELETE FROM` 清空再 INSERT
- **事务包裹**：大表入库用 `BEGIN/COMMIT/ROLLBACK`，中途失败不丢旧数据（见 93 脚本）
- **列名小写下划线**，禁中文禁空格

### 三类对象的写权限
| 对象 | 谁能写 | 备注 |
|------|--------|------|
| `data_dictionary.json` | **只能 gen_data_dict.py 生成** | 禁手工改 |
| 业务脚本 @meta | 模型改表时同步 | run.py 读它 |
| `tables.json` | run.py add/remove 维护 | 运行状态 |

---

## 四、内存规范（防 OOM）

> 痛点：GP 指标曾因 1.1 亿行全量驻留内存 OOM。规范如下。

### 数据量分级与处理方式
| 行数 | 处理方式 | 例 |
|------|----------|-----|
| < 10万 | DataFrame 全量 | trading_calendar, dim 表 |
| 10万-1千万 | 分批 register/INSERT | sector_trading_data |
| > 1千万 | **必须流式**：reader 按批 yield + 逐批入库 | stock_gp1_46, stock_daily_kline |

### 流式入库模板（大表强制）
```python
def save_data(con):
    con.execute("BEGIN")
    con.execute("DELETE FROM table")
    for batch in reader.stream():      # 生成器, 每批几万行
        con.register("_b", batch)
        con.execute("INSERT INTO table SELECT * FROM _b")
        con.unregister("_b")
    con.execute("COMMIT")
```
- 参考实现：`4_工具/tdx_reader.py` 的 `read_gp_stream()`、`read_daily_stream()`
- **禁止** `pd.read_xxx()` 把全历史一次性读进内存
- **禁止** `df.to_sql()` 全量 push 大表

### 写前自检
- 预估行数：`wc -l` 文件 或 看源文件大小 ÷ 单条字节数
- 单批建议 < 50万行（< 1GB 内存）
- 不确定就先小批试跑（`LIMIT 1000` 验证类型映射）

---

## 五、三方一致性（SSOT 闭环）

```
脚本 @meta  ──┐
              ├──→ gen_data_dict.py ──→ data_dictionary.json (字段级SSOT)
DB DESCRIBE ──┘                     └──→ docs/data_dict.md (人读)
FIELD_MAP ──┘
tables.json ──────────────────────────── check_integrity.py (校验三方对齐)
```

任一方改动，跑 `sync-dict` 重算，跑 `integrity` 校验，必须 **0 RED / 0 YEL / 0 BLU**。

| 报警 | 含义 | 处理 |
|------|------|------|
| RED 孤儿表 | DB有表无脚本 | DROP 或补脚本 |
| YEL 死脚本 | 有@meta无DB表 | 跑入库或归档 |
| BLU 失同步 | tables.json↔@meta 不一致 | sync-dict 重算 |
| TODO 字段 | 字段中文未补 | 非阻塞，逐步补 FIELD_MAP |

---

## 命令速查

```bash
# 表管理驾驶舱（最高频：看清 / 取数 / 补数）
python run.py catalog            # 有哪些表？ 类型(事实/维度/视图)+脚本↔表↔中文+行数
python run.py health             # 健不健康？ 新鲜度红绿灯(按schedule)+一致性
python run.py health --fix       # 补数：滞后/空表逐表[y/N]确认重跑(默认跳过)
python run.py health --fix --yes # 同上，批量不逐表问
python run.py join <表>          # 怎么关联取数？ 找可join的dim表+_labeled视图+JOIN模板
python run.py check <表>         # 查某表：字段(带中文)+行数+脚本

# 日常入库
python run.py all                # 按 schedule 跑入库+计算 [--weekly|--full]
python run.py scan               # 旧版红绿扫描(行数+日期)，health 是增强版
python run.py fix <表>           # 强制重跑单表

# 治理
python run.py integrity          # 一致性检查 (必 0 异常)
python run.py sync-dict          # 重新生成数据字典
python config/gen_data_dict.py --check    # 只校验不写

# 查字典
cat docs/data_dict.md            # 人读版
python -c "import json; print(json.dumps(json.load(open('config/data_dictionary.json',encoding='utf-8'))['<表名>'], ensure_ascii=False, indent=2))"
```
