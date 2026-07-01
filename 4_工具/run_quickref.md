# run.py 傻瓜式速查手册

> **复制粘贴就能跑**,不知道跑啥就看这个。
> 一切命令以 `cd /d K:\DB数据库_v2` 开头(切换到项目根)。

---

## 22 个命令速查表

| # | 命令 | 干啥 | 必跑? |
|---|---|---|---|
| 1 | `python run.py kline` | 跑 K 线(10/80/81/82/83/84/17/18) | ⭐ 补数据最常用 |
| 2 | `python run.py all` | 跑所有 daily 表(按 @meta schedule 自动过滤) | ✅ 替代手动一个个跑 |
| 3 | `python run.py all --weekly` | 跑所有 weekly/daily(周五用) | ✅ 周五跑 |
| 4 | `python run.py all --monthly` | 跑所有 monthly(月末用) | ✅ 月末跑 |
| 5 | `python run.py all --full` | 强制全量重跑 | ⚠️ 慎用,会清空重灌 |
| 6 | `python run.py 80` | 只跑 080_stock_kline_1m 一张表 | ✅ 精确控制 |
| 7 | `python run.py 80 81 10` | 多空格分隔,跑多张表 | ✅ 批量控制 |
| 8 | `python run.py fix 10 --date 20260630` | 补某一天某张表 | ✅ 补缺失日 |
| 9 | `python run.py fix 080` | 强刷单表(全清重灌) | ⚠️ 慎用 |
| 10 | `python run.py sync-dict` | 重生数据字典 | ✅ 改字段后必跑 |
| 11 | `python run.py integrity` | 一致性校验(RED/YEL/BLU) | ✅ 改完必跑 |
| 12 | `python run.py check-dup` | 全表去重巡检 | ✅ 改完必跑 |
| 13 | `python run.py check-dup stock_kline_5m` | 单表去重巡检 | ✅ 改完必跑 |
| 14 | `python run.py health` | 健康总览(scan+integrity+新鲜度) | ✅ 出问题先跑 |
| 15 | `python run.py health --fix` | 健康体检+交互式补数 | ⚠️ 高阶 |
| 16 | `python run.py health --fix --yes` | 健康体检+全自动补数 | ⚠️ 高阶 |
| 17 | `python run.py scan` | 扫描健康(表/行数/最近更新) | ✅ 看全局 |
| 18 | `python run.py check stock_kline_1m` | 深检某张表(字段/schema) | ✅ 排查用 |
| 19 | `python run.py catalog` | 总目录(表/脚本/类型/行数) | ✅ 看架构 |
| 20 | `python run.py join stock_kline_1m` | 查可 JOIN 的维度表 | ⚠️ 调表时 |
| 21 | `python run.py get stock_daily_kline --code 000001.SZ --days 30` | 导出某股最近 N 天 K 线 | ✅ 看数据 |
| 22 | `python run.py backup` | 备份整库 | ⚠️ 手动冷备 |

---

## 常用组合(直接复制粘贴)

### 组合 A:补 K 线数据

```cmd
cd /d K:\DB数据库_v2
python run.py kline
```

### 组合 B:改完脚本验收(改字段/改 SQL 后)

```cmd
cd /d K:\DB数据库_v2
python run.py kline
python run.py sync-dict
python run.py integrity
python run.py check-dup
```

### 组合 C:周末补周 K(周五跑)

```cmd
cd /d K:\DB数据库_v2
python run.py all --weekly
```

### 组合 D:月末补月 K(月末跑)

```cmd
cd /d K:\DB数据库_v2
python run.py all --monthly
```

### 组合 E:补某一天某张表

```cmd
cd /d K:\DB数据库_v2
python run.py fix 10 --date 20260630
```

### 组合 F:出问题排查

```cmd
cd /d K:\DB数据库_v2
python run.py health
```

---

## 最高频 1 行(99% 场景)

**补数据**:

```cmd
cd /d K:\DB数据库_v2 && python run.py kline
```

**改完脚本验收**:

```cmd
cd /d K:\DB数据库_v2 && python run.py sync-dict && python run.py integrity && python run.py check-dup
```

---

## 出问题先跑

```cmd
cd /d K:\DB数据库_v2
python run.py health
```

不知道怎么办 → 截图发我。