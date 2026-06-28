#!/usr/bin/env python3
# @meta table=table_analysis cn=表分析报告 dir=reports sort=001
# @meta schedule=manual mode=report source=profit_radar.duckdb
"""数据库表分析任务 - 自动生成表简介和价值评估

运行方式: python reports/table_analysis.py
"""

import json
import duckdb
from datetime import datetime
from pathlib import Path

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
OUTPUT_DIR = Path(r'K:\DB数据库_v2\reports')
OUTPUT_DIR.mkdir(exist_ok=True)

# 从 tables.json 读取表列表
def load_tables():
    with open('config/tables.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    tables = {k: v for k, v in data.items() if k != '_meta'}
    return tables

# 分析单个表
def analyze_table(con, table_name, config):
    result = {
        'table': table_name,
        'cn': config.get('cn', ''),
        'source': config.get('source', ''),
        'schedule': config.get('schedule', ''),
        'dir': config.get('dir', ''),
        'sort': config.get('sort', ''),
        'status': config.get('status', 'unknown'),
    }

    try:
        # 检查表是否存在
        exists = con.execute(f"""
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_name = '{table_name}'
        """).fetchone()[0] > 0

        if not exists:
            result['exists'] = False
            result['row_count'] = 0
            result['quality'] = 'MISSING'
            return result

        result['exists'] = True

        # 行数
        result['row_count'] = con.execute(f'SELECT COUNT(*) FROM {table_name}').fetchone()[0]

        # 表结构
        cols = con.execute(f"""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = '{table_name}'
        """).fetchall()
        result['columns'] = [(c[0], c[1]) for c in cols]
        result['column_count'] = len(cols)

        # 检查是否有日期字段
        date_cols = [c[0] for c in cols if 'date' in c[0].lower()]
        result['date_columns'] = date_cols

        # 时间范围（如果有日期字段）
        if date_cols:
            date_col = date_cols[0]  # 用第一个日期字段
            try:
                date_range = con.execute(f"""
                    SELECT MIN({date_col}), MAX({date_col})
                    FROM {table_name}
                """).fetchone()
                result['min_date'] = str(date_range[0]) if date_range[0] else None
                result['max_date'] = str(date_range[1]) if date_range[1] else None
                if date_range[0] and date_range[1]:
                    result['days_span'] = (date_range[1] - date_range[0]).days
            except:
                pass

        # 示例数据
        sample = con.execute(f'SELECT * FROM {table_name} LIMIT 1').fetchone()
        result['has_data'] = sample is not None

        # 空值检查（抽样前1000行）
        null_checks = []
        for col, dtype in cols[:5]:  # 只检查前5列
            if dtype in ('DOUBLE', 'INTEGER', 'BIGINT'):
                null_pct = con.execute(f"""
                    SELECT
                        CASE WHEN COUNT(*) > 0
                        THEN SUM(CASE WHEN {col} IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
                        ELSE 0 END
                    FROM (SELECT * FROM {table_name} LIMIT 10000)
                """).fetchone()[0]
                if null_pct > 50:
                    null_checks.append(f'{col}: {null_pct:.1f}%空')
        result['null_warnings'] = null_checks

        # 零值检查
        zero_checks = []
        for col, dtype in cols[:3]:
            if dtype in ('DOUBLE', 'INTEGER', 'BIGINT'):
                zero_pct = con.execute(f"""
                    SELECT
                        CASE WHEN COUNT(*) > 0
                        THEN SUM(CASE WHEN {col} = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
                        ELSE 0 END
                    FROM (SELECT * FROM {table_name} LIMIT 10000)
                """).fetchone()[0]
                if zero_pct > 90:
                    zero_checks.append(f'{col}: {zero_pct:.1f}%零')
        result['zero_warnings'] = zero_checks

        # 质量评估
        issues = []
        if result.get('null_warnings'):
            issues.extend(result['null_warnings'])
        if result.get('zero_warnings'):
            issues.extend(result['zero_warnings'])

        if not result['exists']:
            result['quality'] = 'MISSING'
        elif result['row_count'] == 0:
            result['quality'] = 'EMPTY'
        elif issues:
            result['quality'] = 'WARNING'
            result['issues'] = issues
        else:
            result['quality'] = 'OK'

        # 价值评估
        result['value_score'] = assess_value(result)

    except Exception as e:
        result['error'] = str(e)
        result['quality'] = 'ERROR'

    return result

def assess_value(info):
    """评估表的价值"""
    score = 50  # 基础分
    reasons = []

    # 数据量加分
    row_count = info.get('row_count', 0)
    if row_count > 1000000:
        score += 20
        reasons.append(f'数据量大({row_count:,})')
    elif row_count > 100000:
        score += 15
        reasons.append(f'数据量中等({row_count:,})')
    elif row_count > 10000:
        score += 10
        reasons.append(f'数据量可接受({row_count:,})')
    elif row_count > 100:
        score += 5
        reasons.append(f'数据量较少({row_count:,})')
    else:
        score -= 20
        reasons.append(f'数据量极少({row_count})')

    # 时间跨度加分
    days_span = info.get('days_span', 0)
    if days_span > 3650:
        score += 20
        reasons.append(f'历史长({days_span//365}年)')
    elif days_span > 365:
        score += 10
        reasons.append(f'1年以上({days_span}天)')
    elif days_span > 30:
        score += 5
        reasons.append(f'{days_span}天数据')
    elif days_span > 0:
        reasons.append(f'仅{days_span}天')

    # 质量问题扣分
    if info.get('quality') == 'WARNING':
        score -= 20
        reasons.append('有空值/零值问题')
    elif info.get('quality') == 'EMPTY':
        score = 0
        reasons.append('空表')
    elif info.get('quality') == 'MISSING':
        score = 0
        reasons.append('表不存在')

    info['value_reasons'] = reasons

    # 标记
    if score >= 70:
        info['value_tag'] = 'KEEP'
    elif score >= 40:
        info['value_tag'] = 'REVIEW'
    else:
        info['value_tag'] = 'DELETE'

    return score

def generate_report(analyses):
    """生成报告"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # 1. 生成 Markdown 报告
    md_content = f"""# 数据库表分析报告

> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
> **分析表数**: {len(analyses)}

---

## 一、汇总

| 标记 | 数量 | 说明 |
|------|------|------|
| KEEP | {sum(1 for a in analyses if a.get('value_tag') == 'KEEP')} | 保留，继续使用 |
| REVIEW | {sum(1 for a in analyses if a.get('value_tag') == 'REVIEW')} | 待人工复核 |
| DELETE | {sum(1 for a in analyses if a.get('value_tag') == 'DELETE')} | 建议删除 |
| ERROR | {sum(1 for a in analyses if a.get('value_tag') == 'ERROR')} | 分析错误 |

---

## 二、建议保留的表 (KEEP)

"""
    for a in sorted(analyses, key=lambda x: -x.get('value_score', 0)):
        if a.get('value_tag') == 'KEEP':
            md_content += f"""### {a['table']}

- **中文名**: {a.get('cn', '')}
- **行数**: {a.get('row_count', 0):,}
- **列数**: {a.get('column_count', 0)}
- **时间范围**: {a.get('min_date', 'N/A')} ~ {a.get('max_date', 'N/A')}
- **数据源**: {a.get('source', '')} ({a.get('schedule', '')})
- **评分**: {a.get('value_score', 0)}
- **理由**: {', '.join(a.get('value_reasons', []))}

"""

    md_content += """---

## 三、待复核的表 (REVIEW)

"""
    for a in sorted(analyses, key=lambda x: -x.get('value_score', 0)):
        if a.get('value_tag') == 'REVIEW':
            issues = ', '.join(a.get('issues', [])) if a.get('issues') else '数据量或时间跨度不足'
            md_content += f"""### {a['table']}

- **中文名**: {a.get('cn', '')}
- **行数**: {a.get('row_count', 0):,}
- **时间范围**: {a.get('min_date', 'N/A')} ~ {a.get('max_date', 'N/A')}
- **评分**: {a.get('value_score', 0)}
- **问题**: {issues}

"""

    md_content += """---

## 四、建议删除的表 (DELETE)

"""
    for a in sorted(analyses, key=lambda x: -x.get('value_score', 0)):
        if a.get('value_tag') == 'DELETE':
            reasons = ', '.join(a.get('value_reasons', [])) if a.get('value_reasons') else a.get('quality', 'N/A')
            md_content += f"""### {a['table']}

- **中文名**: {a.get('cn', '')}
- **行数**: {a.get('row_count', 0):,}
- **状态**: {a.get('quality', 'N/A')}
- **原因**: {reasons}

"""

    md_content += """---

## 五、详细分析

"""
    for a in sorted(analyses, key=lambda x: x.get('table', '')):
        md_content += f"""### {a['table']}

| 属性 | 值 |
|------|-----|
| 中文名 | {a.get('cn', '')} |
| 数据源 | {a.get('source', '')} |
| 更新周期 | {a.get('schedule', '')} |
| 行数 | {a.get('row_count', 0):,} |
| 列数 | {a.get('column_count', 0)} |
| 列 | {', '.join([c[0] for c in a.get('columns', [])])} |
| 时间范围 | {a.get('min_date', 'N/A')} ~ {a.get('max_date', 'N/A')} |
| 时间跨度 | {a.get('days_span', 0)} 天 |
| 质量 | {a.get('quality', 'N/A')} |
| 评分 | {a.get('value_score', 0)} |
| 标记 | **{a.get('value_tag', 'UNKNOWN')}** |
| 理由 | {', '.join(a.get('value_reasons', []))} |

"""

    # 保存 Markdown
    md_file = OUTPUT_DIR / f'table_analysis_{timestamp}.md'
    with open(md_file, 'w', encoding='utf-8') as f:
        f.write(md_content)

    # 2. 生成 JSON 详细数据
    json_file = OUTPUT_DIR / f'table_analysis_{timestamp}.json'
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(analyses, f, ensure_ascii=False, indent=2, default=str)

    # 3. 生成待确认删除列表
    delete_list = [a['table'] for a in analyses if a.get('value_tag') == 'DELETE']
    review_list = [a['table'] for a in analyses if a.get('value_tag') == 'REVIEW']

    confirm_file = OUTPUT_DIR / 'table_delete_candidates.txt'
    with open(confirm_file, 'w', encoding='utf-8') as f:
        f.write('# 待确认删除的表\n')
        f.write('# 请人工确认后手动删除\n\n')
        for t in delete_list:
            f.write(f'{t}\n')
        f.write('\n# 待复核的表\n')
        for t in review_list:
            f.write(f'# {t}\n')

    return md_file, json_file, confirm_file

def main():
    print("=" * 60)
    print("数据库表分析任务")
    print("=" * 60)

    # 连接数据库
    con = duckdb.connect(DB_PATH, read_only=True)

    # 加载表列表
    tables = load_tables()
    print(f"\n加载 {len(tables)} 个表配置")

    # 分析每个表
    analyses = []
    for i, (name, config) in enumerate(sorted(tables.items())):
        print(f"[{i+1}/{len(tables)}] 分析 {name}...", end=' ')
        result = analyze_table(con, name, config)
        analyses.append(result)
        status = result.get('quality', '?')
        tag = result.get('value_tag', '?')
        rows = result.get('row_count', 0)
        print(f"({rows:,}行, {status}, {tag})")

    con.close()

    # 生成报告
    print("\n生成报告...")
    md_file, json_file, confirm_file = generate_report(analyses)

    print("\n" + "=" * 60)
    print("分析完成!")
    print("=" * 60)
    print(f"\n报告文件:")
    print(f"  详细报告: {md_file}")
    print(f"  JSON数据: {json_file}")
    print(f"  待确认列表: {confirm_file}")

    # 汇总
    keep = sum(1 for a in analyses if a.get('value_tag') == 'KEEP')
    review = sum(1 for a in analyses if a.get('value_tag') == 'REVIEW')
    delete = sum(1 for a in analyses if a.get('value_tag') == 'DELETE')

    print(f"\n汇总:")
    print(f"  KEEP: {keep}")
    print(f"  REVIEW: {review}")
    print(f"  DELETE: {delete}")

if __name__ == '__main__':
    main()
