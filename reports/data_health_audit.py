#!/usr/bin/env python3
# @meta table=data_health_audit cn=数据健康度审核 dir=reports sort=003
# @meta schedule=manual mode=report source=profit_radar.duckdb
"""数据健康度审核脚本

检测数据质量问题：
1. 空值比例异常
2. 零值比例异常（数据缺失标记）
3. 数值范围异常（负数、超大值）
4. 日期范围异常（未来日期、过早日期）
5. 重复数据检测
6. 代码格式不一致

运行方式: python reports/data_health_audit.py
"""

import json
import duckdb
from datetime import datetime, date
from pathlib import Path
from collections import defaultdict

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
OUTPUT_DIR = Path(r'K:\DB数据库_v2\reports')
OUTPUT_DIR.mkdir(exist_ok=True)

# 表的元数据配置
TABLE_META = {
    'stock_daily_kline': {
        'cn': '股票日K线',
        'date_col': 'date',
        'code_col': 'code',
        'expected_range': ('1990-01-01', '2030-12-31'),
        'price_cols': ['open', 'high', 'low', 'close'],
        'volume_col': 'volume',
        'amount_col': 'amount',
    },
    'stock_kline_1m': {
        'cn': '股票1分钟K线',
        'date_col': 'trade_time',
        'code_col': 'code',
        'price_cols': ['open', 'high', 'low', 'close'],
        'volume_col': 'volume',
        'amount_col': 'amount',
    },
    'stock_kline_5m': {
        'cn': '股票5分钟K线',
        'date_col': 'trade_time',
        'code_col': 'code',
        'price_cols': ['open', 'high', 'low', 'close'],
        'volume_col': 'volume',
        'amount_col': 'amount',
    },
    'dwd_stock_capital_flow': {
        'cn': '资金流向',
        'date_col': 'trade_date',
        'code_col': 'code',
        'nullable_expected': ['active_buy_net', 'seal_amount', 'vwap', 'first_limit_up_time'],
    },
    'etf_daily_kline': {
        'cn': 'ETF日K线',
        'date_col': 'date',
        'code_col': 'code',
        'expected_range': ('2019-01-01', '2030-12-31'),
        'price_cols': ['open', 'high', 'low', 'close'],
        'volume_col': 'volume',
        'amount_col': 'amount',
    },
    'lhb_daily': {
        'cn': '龙虎榜日常',
        'date_col': 'trade_date',
        'code_col': 'code',
        'expected_range': ('2020-01-01', '2030-12-31'),
    },
    'market_trading_data': {
        'cn': '市场交易数据',
        'date_col': 'date',
        'expected_range': ('2015-01-01', '2030-12-31'),
    },
}


def get_table_columns(con, table_name):
    """获取表的所有列信息"""
    cols = con.execute(f"""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = '{table_name}'
        ORDER BY ordinal_position
    """).fetchall()
    return [(c[0], c[1]) for c in cols]


def check_null_ratio(con, table_name, col_name, sample_size=10000):
    """检查空值比例"""
    sql = f"""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN {col_name} IS NULL THEN 1 ELSE 0 END) as null_count
        FROM (SELECT {col_name} FROM {table_name} LIMIT {sample_size})
    """
    try:
        result = con.execute(sql).fetchone()
        if result[0] == 0:
            return None
        return (result[1] / result[0]) * 100
    except:
        return None


def check_zero_ratio(con, table_name, col_name, dtype, sample_size=10000):
    """检查零值比例（仅对数值列）"""
    if dtype not in ('DOUBLE', 'INTEGER', 'BIGINT', 'DECIMAL'):
        return None

    sql = f"""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN {col_name} = 0 THEN 1 ELSE 0 END) as zero_count
        FROM (SELECT {col_name} FROM {table_name} WHERE {col_name} IS NOT NULL LIMIT {sample_size})
    """
    try:
        result = con.execute(sql).fetchone()
        if result[0] == 0:
            return None
        return (result[1] / result[0]) * 100
    except:
        return None


def check_negative_values(con, table_name, col_name, sample_size=5000):
    """检查负值比例"""
    sql = f"""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN {col_name} < 0 THEN 1 ELSE 0 END) as neg_count
        FROM (SELECT {col_name} FROM {table_name} WHERE {col_name} IS NOT NULL LIMIT {sample_size})
    """
    try:
        result = con.execute(sql).fetchone()
        if result[0] == 0:
            return None
        return (result[1] / result[0]) * 100
    except:
        return None


def check_date_range(con, table_name, date_col, expected_range=None):
    """检查日期范围"""
    sql = f"""
        SELECT MIN({date_col}), MAX({date_col})
        FROM {table_name}
    """
    try:
        result = con.execute(sql).fetchone()
        min_date = result[0]
        max_date = result[1]

        if not min_date or not max_date:
            return None, None, None

        issues = []

        # 检查未来日期
        today = date.today()
        if max_date > today:
            issues.append(f'存在未来日期: {max_date}')

        # 检查预期范围
        if expected_range:
            exp_min, exp_max = expected_range
            if min_date < datetime.strptime(exp_min, '%Y-%m-%d').date():
                issues.append(f'日期早于预期: {min_date}')
            if max_date > datetime.strptime(exp_max, '%Y-%m-%d').date():
                issues.append(f'日期晚于预期: {max_date}')

        return min_date, max_date, issues
    except Exception as e:
        return None, None, [str(e)]


def check_duplicate_rows(con, table_name, pk_cols, sample_size=10000):
    """检查重复数据"""
    cols_str = ', '.join(pk_cols)
    sql = f"""
        SELECT {cols_str}, COUNT(*) as cnt
        FROM (SELECT {cols_str} FROM {table_name} LIMIT {sample_size})
        GROUP BY {cols_str}
        HAVING COUNT(*) > 1
    """
    try:
        dupes = con.execute(sql).fetchall()
        if dupes:
            return len(dupes)
        return 0
    except:
        return 0


def check_code_format(con, table_name, code_col):
    """检查代码格式一致性"""
    sql = f"""
        SELECT DISTINCT SUBSTR({code_col}, 1, 2) as prefix, COUNT(*) as cnt
        FROM {table_name}
        GROUP BY SUBSTR({code_col}, 1, 2)
        ORDER BY cnt DESC
    """
    try:
        prefixes = con.execute(sql).fetchall()
        return [(p[0], p[1]) for p in prefixes]
    except:
        return []


def check_price_anomaly(con, table_name, price_col, sample_size=5000):
    """检查价格异常（0.01以下或超过1000000的明显异常）"""
    sql = f"""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN {price_col} < 0.01 AND {price_col} > 0 THEN 1 ELSE 0 END) as too_small,
            SUM(CASE WHEN {price_col} > 1000000 THEN 1 ELSE 0 END) as too_large
        FROM (SELECT {price_col} FROM {table_name} WHERE {price_col} IS NOT NULL LIMIT {sample_size})
    """
    try:
        result = con.execute(sql).fetchone()
        if result[0] == 0:
            return None, None
        return result[1], result[2]
    except:
        return None, None


def analyze_table_health(con, table_name, meta=None):
    """分析单个表的数据健康度"""
    result = {
        'table': table_name,
        'cn': meta.get('cn', table_name) if meta else table_name,
        'issues': [],
        'warnings': [],
        'health_score': 100,
    }

    try:
        # 获取表结构
        cols = get_table_columns(con, table_name)
        result['columns'] = [c[0] for c in cols]
        result['column_count'] = len(cols)

        # 行数
        row_count = con.execute(f'SELECT COUNT(*) FROM {table_name}').fetchone()[0]
        result['row_count'] = row_count

        if row_count == 0:
            result['health_score'] = 0
            result['issues'].append('空表')
            return result

        #1. 空值检查
        for col_name, dtype in cols:
            if meta and col_name in meta.get('nullable_expected', []):
                continue  # 配置为允许空值的列

            null_pct = check_null_ratio(con, table_name, col_name)
            if null_pct is not None:
                if null_pct > 80:
                    result['issues'].append(f'{col_name}: {null_pct:.1f}% 空值')
                    result['health_score'] -= 30
                elif null_pct > 50:
                    result['warnings'].append(f'{col_name}: {null_pct:.1f}% 空值')
                    result['health_score'] -= 10
                elif null_pct > 20:
                    result['health_score'] -= 5

        # 2. 零值检查（数值列）
        for col_name, dtype in cols:
            if dtype not in ('DOUBLE', 'INTEGER', 'BIGINT', 'DECIMAL'):
                continue

            zero_pct = check_zero_ratio(con, table_name, col_name, dtype)
            if zero_pct is not None:
                if zero_pct > 95 and col_name not in ('volume', 'amount'):
                    result['warnings'].append(f'{col_name}: {zero_pct:.1f}% 零值')
                    result['health_score'] -= 5

        # 3. 负值检查
        for col_name, dtype in cols:
            if dtype not in ('DOUBLE', 'INTEGER', 'BIGINT', 'DECIMAL'):
                continue

            neg_pct = check_negative_values(con, table_name, col_name)
            if neg_pct is not None and neg_pct > 10:
                result['issues'].append(f'{col_name}: {neg_pct:.1f}% 负值')
                result['health_score'] -= 15

        # 4. 日期范围检查
        if meta and meta.get('date_col'):
            date_col = meta['date_col']
            expected_range = meta.get('expected_range')
            min_date, max_date, date_issues = check_date_range(
                con, table_name, date_col, expected_range
            )
            if date_issues:
                result['warnings'].extend(date_issues)
            if min_date:
                result['min_date'] = str(min_date)
            if max_date:
                result['max_date'] = str(max_date)

        # 5. 价格异常检查
        if meta and meta.get('price_cols'):
            for price_col in meta['price_cols']:
                too_small, too_large = check_price_anomaly(con, table_name, price_col)
                if too_small and too_small > 0:
                    result['warnings'].append(f'{price_col}: {too_small}条 价格<0.01')
                if too_large and too_large > 0:
                    result['warnings'].append(f'{price_col}: {too_large}条 价格>1000000')

        # 6. 代码格式检查
        if meta and meta.get('code_col'):
            prefixes = check_code_format(con, table_name, meta['code_col'])
            result['code_prefixes'] = prefixes

        # 7. 重复数据检查
        # 检查主键是否有重复
        try:
            # 尝试检测主键
            pk_cols = [c[0] for c in cols[:3]]  # 假设前几列是主键
            dup_count = check_duplicate_rows(con, table_name, pk_cols)
            if dup_count > 0:
                result['warnings'].append(f'主键重复: {dup_count}条')
                result['health_score'] -= 10
        except:
            pass

        # 确保分数在合理范围
        result['health_score'] = max(0, min(100, result['health_score']))

    except Exception as e:
        result['error'] = str(e)
        result['health_score'] = 0
        result['issues'].append(f'分析错误: {str(e)}')

    return result


def generate_report(analyses):
    """生成健康度报告"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # 统计
    total = len(analyses)
    healthy = sum(1 for a in analyses if a.get('health_score', 0) >= 80)
    warning = sum(1 for a in analyses if 50 <= a.get('health_score', 0) < 80)
    critical = sum(1 for a in analyses if a.get('health_score', 0) < 50)

    md = f"""# 数据健康度审核报告

> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
> **数据库**: profit_radar.duckdb

---

## 一、汇总

| 健康度 | 数量 | 说明 |
|--------|------|------|
| ✅ 健康 (>=80) | {healthy} | 数据质量良好 |
| ⚠️ 警告 (50-79) | {warning} | 存在轻微问题 |
| ❌ 危险 (<50) | {critical} | 存在严重问题 |

---

## 二、问题汇总

"""

    # 收集所有问题
    all_issues = []
    all_warnings = []

    for a in analyses:
        table = a['table']
        cn = a.get('cn', table)
        for issue in a.get('issues', []):
            all_issues.append((table, cn, issue))
        for warn in a.get('warnings', []):
            all_warnings.append((table, cn, warn))

    md += f"""### 2.1 严重问题 (Issues) - {len(all_issues)}条

| 表 | 列 | 问题描述 |
|----|----|----------|
"""

    if all_issues:
        for table, cn, issue in all_issues:
            md += f"| {table} | - | {issue} |\n"
    else:
        md += "| - | - | 无严重问题 |\n"

    md += f"""
### 2.2 警告信息 (Warnings) - {len(all_warnings)}条

| 表 | 列 | 问题描述 |
|----|----|----------|
"""

    if all_warnings:
        for table, cn, warn in all_warnings:
            md += f"| {table} | - | {warn} |\n"
    else:
        md += "| - | - | 无警告信息 |\n"

    md += """
---

## 三、详细分析

"""

    for a in sorted(analyses, key=lambda x: x.get('health_score', 0)):
        score = a.get('health_score', 0)
        if score >= 80:
            tag = '✅'
        elif score >= 50:
            tag = '⚠️'
        else:
            tag = '❌'

        md += f"""### {tag} {a['table']}

- **中文名**: {a.get('cn', '')}
- **行数**: {a.get('row_count', 0):,}
- **列数**: {a.get('column_count', 0)}
- **健康度评分**: {score}

"""

        if a.get('min_date'):
            md += f"- **日期范围**: {a['min_date']} ~ {a.get('max_date', 'N/A')}\n"

        if a.get('code_prefixes'):
            prefixes = ', '.join([f'{p[0]}({p[1]:,})' for p in a['code_prefixes'][:5]])
            md += f"- **代码前缀**: {prefixes}\n"

        if a.get('issues'):
            md += f"-**❌ 严重问题**:\n"
            for issue in a['issues']:
                md += f"  - {issue}\n"

        if a.get('warnings'):
            md += f"- **⚠️ 警告**:\n"
            for warn in a['warnings']:
                md += f"  - {warn}\n"

        md += "\n"

    md += f"""
---

## 四、修复建议

### 4.1 高优先级（健康度<50）

"""

    critical_tables = [a for a in analyses if a.get('health_score', 0) < 50]
    if critical_tables:
        for a in critical_tables:
            md += f"""#### {a['table']}
- 问题: {', '.join(a.get('issues', ['未知']))}

"""
    else:
        md += "无高优先级问题\n"

    md += """
### 4.2 中优先级（健康度50-79）

"""

    warning_tables = [a for a in analyses if 50 <= a.get('health_score', 0) < 80]
    if warning_tables:
        for a in warning_tables:
            md += f"""#### {a['table']}
-警告: {', '.join(a.get('warnings', ['待确认']))}

"""
    else:
        md += "无中优先级问题\n"

    md += f"""
---

## 五、数据质量指标

| 指标 | 值 |
|------|-----|
| 分析表数 | {total} |
| 健康表数 | {healthy} ({healthy*100//total if total else 0}%) |
| 警告表数 | {warning} ({warning*100//total if total else 0}%) |
| 危险表数 | {critical} ({critical*100//total if total else 0}%) |
| 严重问题总数 | {len(all_issues)} |
| 警告总数 | {len(all_warnings)} |

---

*报告生成: data_health_audit.py*
"""

    # 保存报告
    md_file = OUTPUT_DIR / f'data_health_audit_{timestamp}.md'
    with open(md_file, 'w', encoding='utf-8') as f:
        f.write(md)

    # 保存JSON
    json_file = OUTPUT_DIR / f'data_health_audit_{timestamp}.json'
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(analyses, f, ensure_ascii=False, indent=2, default=str)

    return md_file, json_file


def main():
    print("=" * 60)
    print("数据健康度审核任务")
    print("=" * 60)

    # 连接数据库
    con = duckdb.connect(DB_PATH, read_only=True)

    # 获取所有表
    db_tables = []
    for t in con.execute('SELECT table_name FROM information_schema.tables').fetchall():
        table_name = t[0]
        # 跳过内部表
        if not table_name.startswith('_') and table_name not in ('table_registry', 'data_dict'):
            db_tables.append(table_name)

    print(f"\n发现 {len(db_tables)} 个数据表\n")

    # 分析每个表
    analyses = []
    for i, table_name in enumerate(sorted(db_tables)):
        meta = TABLE_META.get(table_name)
        print(f"[{i+1}/{len(db_tables)}] 分析 {table_name}...", end=' ')

        result = analyze_table_health(con, table_name, meta)
        analyses.append(result)

        score = result.get('health_score', 0)
        issues = len(result.get('issues', []))
        warns = len(result.get('warnings', []))

        if score >= 80:
            status = '[OK]'
        elif score >= 50:
            status = '[WARN]'
        else:
            status = '[CRIT]'

        print(f"({score} {status}, issues={issues}, warns={warns})")

    con.close()

    # 生成报告
    print("\n生成报告...")
    md_file, json_file = generate_report(analyses)

    # 汇总
    print("\n" + "=" * 60)
    print("审核完成!")
    print("=" * 60)

    healthy = sum(1 for a in analyses if a.get('health_score', 0) >= 80)
    warning = sum(1 for a in analyses if 50 <= a.get('health_score', 0) < 80)
    critical = sum(1 for a in analyses if a.get('health_score', 0) < 50)

    print(f"\nSummary:")
    print(f"  [OK] healthy: {healthy}")
    print(f"  [WARN] warning: {warning}")
    print(f"  [CRIT] critical: {critical}")
    print(f"\n报告: {md_file}")
    print(f"数据: {json_file}")


if __name__ == '__main__':
    main()