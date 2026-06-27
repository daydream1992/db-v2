#!/usr/bin/env python3
# @meta table=cross_analysis cn=交叉分析 dir=reports sort=005
# @meta schedule=manual mode=report source=profit_radar.duckdb
"""深度交叉分析 - 重复检查、空值修复、毒数据识别"""

import duckdb
import json
from pathlib import Path

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'

def cross_check_duplication():
    """交叉检查重复表"""
    con = duckdb.connect(DB_PATH, read_only=True)

    print("=" * 70)
    print("交叉重复检查")
    print("=" * 70)

    checks = [
        # 1. sector_daily_data vs sector_trading_data
        ("sector_daily_data", "sector_trading_data"),
        # 2. stock_trading_data vs gpsz_daily
        ("stock_trading_data", "gpsz_daily"),
        # 3. (removed 2026-06-26) stock_extended_info vs dwd_stock_capital_flow - dwd_stock_capital_flow dropped
        # 4. fact_finance_report vs financial_data
        ("fact_finance_report", "financial_data"),
        # 5. dws_sector_emotion vs sector_daily_data
        ("dws_sector_emotion", "sector_daily_data"),
    ]

    for t1, t2 in checks:
        print(f"\n【{t1} vs {t2}】")
        try:
            cnt1 = con.execute(f'SELECT COUNT(*) FROM {t1}').fetchone()[0]
            cnt2 = con.execute(f'SELECT COUNT(*) FROM {t2}').fetchone()[0]
            print(f"  {t1}: {cnt1:,}行")
            print(f"  {t2}: {cnt2:,}行")

            # 检查列重叠
            cols1 = [c[0] for c in con.execute(f"""
                SELECT column_name FROM information_schema.columns WHERE table_name = '{t1}'
            """).fetchall()]
            cols2 = [c[0] for c in con.execute(f"""
                SELECT column_name FROM information_schema.columns WHERE table_name = '{t2}'
            """).fetchall()]
            overlap = set(cols1) & set(cols2)
            if overlap:
                print(f"  共同列: {overlap}")

            # 检查数据重叠
            if 'sector' in t1 and 'sector' in t2:
                try:
                    # 检查sector_daily_data的change_pct是否全是0
                    zero_pct = con.execute("""
                        SELECT SUM(CASE WHEN change_pct = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
                        FROM sector_daily_data
                    """).fetchone()[0]
                    print(f"  sector_daily_data change_pct=0: {zero_pct:.1f}%")
                except:
                    pass

        except Exception as e:
            print(f"  错误: {e}")

    con.close()

def check_null_columns():
    """检查空值列的数据来源和修复可能"""
    con = duckdb.connect(DB_PATH, read_only=True)

    print("\n" + "=" * 70)
    print("空值列分析 - 检查是否可修复")
    print("=" * 70)

    # 读取健康报告
    report_file = Path('reports').glob('data_health_audit_*.json')
    if report_file:
        with open(list(report_file)[-1], 'r', encoding='utf-8') as f:
            report = json.load(f)

    # 检查严重空值问题
    severe_nulls = []
    for item in report:
        issues = item.get('issues', [])
        for issue in issues:
            if '% 空' in issue or '% 零' in issue:
                pct = float(issue.split(':')[1].strip().replace('% 空', '').replace('% 零', ''))
                if pct > 80:
                    severe_nulls.append({
                        'table': item['table'],
                        'issue': issue,
                        'pct': pct
                    })

    print("\n严重空值问题 (>80%):")
    for item in sorted(severe_nulls, key=lambda x: -x['pct']):
        print(f"  {item['table']}: {item['issue']}")

    # 检查 stock_daily_kline 的空值问题
    print("\n【stock_daily_kline 空值分析】")
    try:
        result = con.execute("""
            SELECT
                SUM(CASE WHEN change_pct IS NULL THEN 1 ELSE 0 END) as null_cnt,
                SUM(CASE WHEN turnover IS NULL THEN 1 ELSE 0 END) as turn_null,
                SUM(CASE WHEN forward_factor IS NULL THEN 1 ELSE 0 END) as factor_null,
                COUNT(*) as total
            FROM stock_daily_kline
        """).fetchone()
        print(f"  change_pct空: {result[0]:,}/{result[3]:,} ({result[0]*100//result[3]}%)")
        print(f"  turnover空: {result[1]:,}/{result[3]:,} ({result[1]*100//result[3]}%)")
        print(f"  forward_factor空: {result[2]:,}/{result[3]:,} ({result[2]*100//result[3]}%)")

        # 这些字段是否可以计算？
        print("\n  可修复性分析:")
        print("  - change_pct: 可通过 (close-prev_close)/prev_close 计算")
        print("  - turnover: 需要成交量/股本，计算较复杂")
        print("  - forward_factor: 前复权因子，需要除权数据")
    except Exception as e:
        print(f"  错误: {e}")

    # 检查 sector_daily_data 零值问题
    print("\n【sector_daily_data 零值分析】")
    try:
        result = con.execute("""
            SELECT
                SUM(CASE WHEN change_pct = 0 THEN 1 ELSE 0 END) as zero_change,
                SUM(CASE WHEN turnover = 0 THEN 1 ELSE 0 END) as zero_turn,
                COUNT(*) as total
            FROM sector_daily_data
        """).fetchone()
        print(f"  change_pct=0: {result[0]:,}/{result[2]:,} ({result[0]*100//result[2]}%)")
        print(f"  turnover=0: {result[1]:,}/{result[2]:,} ({result[1]*100//result[2]}%)")

        # 检查是否是休市日
        result2 = con.execute("""
            SELECT COUNT(DISTINCT date) as total_dates,
                   SUM(CASE WHEN change_pct = 0 THEN 1 ELSE 0 END) as zero_dates
            FROM sector_daily_data
        """).fetchone()
        print(f"  零值日期比例: {result2[1]}/{result2[0]} ({result2[1]*100//result2[0]}%)")
    except Exception as e:
        print(f"  错误: {e}")

    con.close()

def check_script_implementation():
    """检查脚本是否可修复空值"""
    print("\n" + "=" * 70)
    print("脚本修复能力检查")
    print("=" * 70)

    # 读取所有脚本
    for dir_name in ['1_入库', '2_计算']:
        import os
        if not os.path.exists(dir_name):
            continue

        for f in sorted(os.listdir(dir_name)):
            if not f.endswith('.py'):
                continue

            path = f'{dir_name}/{f}'
            with open(path, 'r', encoding='utf-8', errors='ignore') as fp:
                content = fp.read()

            # 检查是否处理空值
            if 'change_pct' in content or 'turnover' in content or 'forward_factor' in content:
                print(f"\n{f} 处理相关字段:")

                # 检查fetch_data实现
                if 'def fetch_data' in content:
                    func_start = content.find('def fetch_data')
                    func_end = content.find('\ndef ', func_start + 1)
                    if func_end == -1:
                        func_end = len(content)
                    func_content = content[func_start:func_end]

                    if '尚未实现' in func_content:
                        print(f"  ❌ fetch_data未实现")
                    elif 'return pd.DataFrame()' in func_content:
                        print(f"  ❌ fetch_data返回空")
                    else:
                        print(f"  ✅ fetch_data已实现")

def identify_poison_data():
    """识别毒数据"""
    con = duckdb.connect(DB_PATH, read_only=True)

    print("\n" + "=" * 70)
    print("毒数据识别")
    print("=" * 70)

    # 1. 全是空值或零值的列
    print("\n【全空/全零列】")
    tables = con.execute('SELECT table_name FROM information_schema.tables').fetchall()

    for t in tables:
        name = t[0]
        if name.startswith('_') or name.startswith('v_'):
            continue

        cols = con.execute(f"""
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = '{name}'
        """).fetchall()

        for col, dtype in cols:
            if dtype not in ('DOUBLE', 'INTEGER', 'BIGINT'):
                continue

            try:
                result = con.execute(f"""
                    SELECT
                        SUM(CASE WHEN {col} IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as null_pct,
                        SUM(CASE WHEN {col} = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as zero_pct
                    FROM {name}
                """).fetchone()

                if result[0] >= 100 or result[1] >= 100:
                    print(f"  {name}.{col}: 空{result[0]:.0f}%, 零{result[1]:.0f}%")
            except:
                pass

    # 2. 只有1天数据的表
    print("\n【只有1天数据的表】")
    all_tables = [t[0] for t in tables]
    date_tables = [t for t in all_tables if any(d in t.lower() for d in ['daily', 'trading', 'lhb', 'kline'])]

    for t in date_tables:
        try:
            cols = [c[0] for c in con.execute(f"""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = '{t}' AND column_name LIKE '%date%'
            """).fetchall()]

            if cols:
                date_col = cols[0]
                result = con.execute(f"""
                    SELECT COUNT(DISTINCT {date_col}) as days, MIN({date_col}), MAX({date_col})
                    FROM {t}
                """).fetchone()

                if result[0] == 1:
                    print(f"  {t}: 只有1天({result[1]})")
        except:
            pass

    # 3. 检查无用表（数据量少且无法更新）
    print("\n【低价值表（可考虑删除）】")
    low_value = []
    for t in all_tables:
        if t.startswith('_') or t.startswith('v_'):
            continue

        try:
            cnt = con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
            if cnt < 1000:
                cols = [c[0] for c in con.execute(f"""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = '{t}'
                """).fetchall()]

                # 检查是否有日期字段
                has_date = any('date' in c.lower() for c in cols)

                if not has_date:
                    low_value.append((t, cnt, '静态表'))
                elif cnt < 500:
                    low_value.append((t, cnt, '数据少'))

        except:
            pass

    for t, cnt, reason in sorted(low_value, key=lambda x: x[1]):
        print(f"  {t}: {cnt}行 ({reason})")

    con.close()

def check_duplicate_keys():
    """检查主键重复"""
    print("\n" + "=" * 70)
    print("主键重复检查")
    print("=" * 70)

    con = duckdb.connect(DB_PATH, read_only=True)

    tables_with_issues = [
        ('lhb_broker_detail', 'lhb_date, broker_name, seq'),
        ('stock_technical_indicators', 'code, date, formula_name, output_key'),
        ('financial_data', 'code, date, report_type, field_name'),
    ]

    for table, key_cols in tables_with_issues:
        print(f"\n【{table}】主键: {key_cols}")
        try:
            # 检查重复
            result = con.execute(f"""
                SELECT {key_cols}, COUNT(*) as cnt
                FROM {table}
                GROUP BY {key_cols}
                HAVING COUNT(*) > 1
                LIMIT 5
            """).fetchall()

            if result:
                print(f"  发现 {len(result)} 个重复组合")
                for r in result[:3]:
                    print(f"    {r}")
            else:
                print("  无重复")
        except Exception as e:
            print(f"  错误: {e}")

    con.close()

if __name__ == '__main__':
    print("深度交叉分析")
    print("=" * 70)

    cross_check_duplication()
    check_null_columns()
    check_script_implementation()
    identify_poison_data()
    check_duplicate_keys()