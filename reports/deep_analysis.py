#!/usr/bin/env python3
# @meta table=deep_analysis cn=深度分析 dir=reports sort=004
# @meta schedule=manual mode=report source=profit_radar.duckdb
"""深度分析脚本 - 探查重复、可替代性、数据价值"""

import duckdb
from collections import Counter

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'

def deep_analysis():
    con = duckdb.connect(DB_PATH, read_only=True)

    # 需要深度分析的表
    tables = [
        'stock_dividend_data', 'stock_sector_relation', 'sector_stocks',
        'financial_data', 'gpsz_daily', 'go_data', 'data_sync_log',
        'etf_index_tracking', 'sector_hierarchy', 'sector_list',
        'dim_fn_meta', 'lhb_broker_stat', 'lhb_stock_stat',
        'lhb_institution_detail', 'lhb_institution_increase',
        'lhb_yyb_activity', 'fact_finance_report'
    ]

    results = []

    for table in tables:
        print(f"\n{'='*60}")
        print(f"分析: {table}")
        print('='*60)

        info = {'table': table}

        try:
            # 1. 基本信息
            row_count = con.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
            info['row_count'] = row_count

            cols = [c[0] for c in con.execute(f"""
                SELECT column_name FROM information_schema.columns WHERE table_name = '{table}'
            """).fetchall()]
            info['columns'] = cols
            print(f"行数: {row_count:,}")
            print(f"列: {cols}")

            # 2. 日期范围
            date_cols = [c for c in cols if 'date' in c.lower()]
            if date_cols:
                dc = date_cols[0]
                date_range = con.execute(f"""
                    SELECT MIN({dc}), MAX({dc}) FROM {table}
                """).fetchone()
                info['min_date'] = str(date_range[0])
                info['max_date'] = str(date_range[1])
                print(f"日期范围: {date_range[0]} ~ {date_range[1]}")

            # 3. 重复检查
            # 找出可能有重复的列组合
            if 'code' in cols and 'date' in cols:
                dup_check = con.execute(f"""
                    SELECT {date_cols[0] if date_cols else cols[0]}, COUNT(*) as cnt
                    FROM {table}
                    GROUP BY {date_cols[0] if date_cols else cols[0]}
                    HAVING COUNT(*) > 1
                    LIMIT 5
                """).fetchall()
                if dup_check:
                    print(f"发现重复: {len(dup_check)}个日期有多条记录")
                    info['has_duplicates'] = True
                else:
                    print("无重复")
                    info['has_duplicates'] = False

            # 4. 空值检查
            for col in cols[:5]:
                dtype = con.execute(f"""
                    SELECT data_type FROM information_schema.columns
                    WHERE table_name = '{table}' AND column_name = '{col}'
                """).fetchone()[0]
                if dtype in ('DOUBLE', 'INTEGER', 'BIGINT'):
                    null_pct = con.execute(f"""
                        SELECT
                            SUM(CASE WHEN {col} IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
                        FROM {table}
                    """).fetchone()[0]
                    if null_pct > 50:
                        print(f"  {col}: {null_pct:.1f}% 空")
                        info.setdefault('null_issues', []).append(f"{col}: {null_pct:.1f}%空")

            # 5. 可替代性检查
            info['alternatives'] = []

            if 'sector' in table.lower() or 'stock_sector' in table:
                # 检查与 sector_stocks 的重复
                if table != 'sector_stocks':
                    try:
                        cnt1 = con.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                        cnt2 = con.execute('SELECT COUNT(*) FROM sector_stocks').fetchone()[0]
                        print(f"vs sector_stocks: {table}={cnt1:,}, sector_stocks={cnt2:,}")
                        info['alternatives'].append(f"sector_stocks({cnt2:,})")
                    except:
                        pass

            if table == 'stock_sector_relation':
                try:
                    # 检查与 sector_stocks 的关系
                    overlap = con.execute("""
                        SELECT COUNT(*) FROM stock_sector_relation r
                        WHERE EXISTS (SELECT 1 FROM sector_stocks s
                                    WHERE s.sector_code = r.sector_code
                                      AND s.stock_code = r.stock_code)
                    """).fetchone()[0]
                    total = con.execute('SELECT COUNT(*) FROM stock_sector_relation').fetchone()[0]
                    print(f"sector_stocks重叠率: {overlap}/{total} ({overlap*100//total}%)")
                    info['overlap_rate'] = f"{overlap*100//total}%"
                except:
                    pass

            if 'dividend' in table.lower():
                # 检查分红数据是否在其他表
                try:
                    cnt = con.execute('SELECT COUNT(*) FROM fact_finance_report WHERE ex_date IS NOT NULL').fetchone()[0]
                    print(f"fact_finance_report中ex_date非空: {cnt:,}")
                    info['alternatives'].append(f"fact_finance_report.ex_date({cnt:,})")
                except:
                    pass

            if 'financial' in table.lower():
                try:
                    cnt = con.execute('SELECT COUNT(*) FROM fact_finance_report').fetchone()[0]
                    print(f"fact_finance_report: {cnt:,}行")
                    info['alternatives'].append(f"fact_finance_report({cnt:,})")
                except:
                    pass

            # 6. 数据类型分布
            if 'type' in cols:
                type_dist = con.execute(f"""
                    SELECT {cols[cols.index('type') if 'type' in cols else 0]}, COUNT(*) as cnt
                    FROM {table}
                    GROUP BY {cols[cols.index('type') if 'type' in cols else 0]}
                    ORDER BY cnt DESC
                    LIMIT 5
                """).fetchall()
                print(f"类型分布: {type_dist[:3]}")
                info['type_dist'] = dict(type_dist[:5])

            # 7. 示例数据
            sample = con.execute(f'SELECT * FROM {table} LIMIT 1').fetchone()
            print(f"示例: {sample[:4]}...")
            info['sample'] = str(sample[:4])

            results.append(info)

        except Exception as e:
            print(f"错误: {e}")
            info['error'] = str(e)
            results.append(info)

    con.close()
    return results

def check_cross_table_duplication():
    """检查跨表重复"""
    con = duckdb.connect(DB_PATH, read_only=True)

    print("\n" + "="*60)
    print("跨表重复检查")
    print("="*60)

    # 1. sector_list vs sector_hierarchy
    print("\n1. sector_list vs sector_hierarchy")
    try:
        cnt1 = con.execute('SELECT COUNT(*) FROM sector_list').fetchone()[0]
        cnt2 = con.execute('SELECT COUNT(*) FROM sector_hierarchy').fetchone()[0]
        print(f"  sector_list: {cnt1:,}, sector_hierarchy: {cnt2:,}")

        overlap = con.execute("""
            SELECT COUNT(*) FROM sector_list l
            WHERE EXISTS (SELECT 1 FROM sector_hierarchy h WHERE h.sector_code = l.sector_code)
        """).fetchone()[0]
        print(f"  重叠记录: {overlap:,} ({overlap*100//cnt1}%)")
    except Exception as e:
        print(f"  错误: {e}")

    # 2. stock_sector_relation vs sector_stocks
    print("\n2. stock_sector_relation vs sector_stocks")
    try:
        cnt1 = con.execute('SELECT COUNT(*) FROM stock_sector_relation').fetchone()[0]
        cnt2 = con.execute('SELECT COUNT(*) FROM sector_stocks').fetchone()[0]
        print(f"  stock_sector_relation: {cnt1:,}, sector_stocks: {cnt2:,}")

        # 检查是否完全包含
        r_in_s = con.execute("""
            SELECT COUNT(*) FROM stock_sector_relation r
            WHERE EXISTS (SELECT 1 FROM sector_stocks s
                        WHERE s.sector_code = r.sector_code AND s.stock_code = r.stock_code)
        """).fetchone()[0]
        s_in_r = con.execute("""
            SELECT COUNT(*) FROM sector_stocks s
            WHERE EXISTS (SELECT 1 FROM stock_sector_relation r
                        WHERE r.sector_code = s.sector_code AND r.stock_code = s.stock_code)
        """).fetchone()[0]
        print(f"  r在s中: {r_in_s:,}, s在r中: {s_in_r:,}")
    except Exception as e:
        print(f"  错误: {e}")

    # 3. financial_data vs fact_finance_report
    print("\n3. financial_data vs fact_finance_report")
    try:
        cnt1 = con.execute('SELECT COUNT(*) FROM financial_data').fetchone()[0]
        cnt2 = con.execute('SELECT COUNT(*) FROM fact_finance_report').fetchone()[0]
        print(f"  financial_data: {cnt1:,}, fact_finance_report: {cnt2:,}")
    except Exception as e:
        print(f"  错误: {e}")

    # 4. gpsz_daily 独有数据
    print("\n4. gpsz_daily 独有数据")
    try:
        types = con.execute("""
            SELECT data_type, COUNT(*) as cnt
            FROM gpsz_daily
            GROUP BY data_type
            ORDER BY cnt DESC
        """).fetchall()
        print("  类型分布:")
        for t, c in types[:10]:
            print(f"    {t}: {c:,}")
    except Exception as e:
        print(f"  错误: {e}")

    con.close()

if __name__ == '__main__':
    results = deep_analysis()
    check_cross_table_duplication()
