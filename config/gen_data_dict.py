#!/usr/bin/env python3
"""数据字典生成器与校验器

数据源:
  1. 脚本头部 @meta  → 表元数据 (复用 run.py.parse_meta)
  2. DB DESCRIBE     → 字段名+类型
  3. 脚本内 FIELD_MAP (ast 解析) → 字段中文名
  4. dim_*_indicator 维度表       → 枚举指标含义

命令:
  python config/gen_data_dict.py --sync    同步生成字典
  python config/gen_data_dict.py --check   只校验, 不写
"""
import sys, os, re, ast, json
import argparse
import duckdb
from pathlib import Path
from datetime import datetime

# 通用字段中文知识库 (英文缩写/标识符 → 中文)
# 用于兜底: 列名是通用缩写时自动填中文, 不需每张表维护 FIELD_MAP
COMMON_CN = {
    # 标准字段
    'date': '日期', 'time': '时间', 'code': '代码', 'name': '名称',
    'market': '市场', 'type': '类型', 'note': '备注', 'unit': '单位',
    'trade_time': '交易时间', 'trade_date': '交易日期',
    # K线
    'open': '开盘价', 'high': '最高价', 'low': '最低价', 'close': '收盘价',
    'volume': '成交量', 'amount': '成交额',
    # 金融缩写
    'pe_ttm': '市盈率TTM', 'pb_mrq': '市净率MRQ', 'ps_ttm': '市销率TTM', 'pc_ttm': '市现率TTM',
    'eps': '每股收益', 'roe': '净资产收益率', 'roa': '总资产收益率',
    'vwap': '成交量加权均价', 'macd': 'MACD', 'kdj': 'KDJ', 'rsi': 'RSI',
    # 板块/标识符
    'bk_name': '板块指标名', 'bk_code': '板块代码',
}

# 通达信字段映射
TDX_FIELD_MAP = None
TDX_MAP_PATH = Path(__file__).parent.parent / 'K:/通达信量化平台说明书/通达信量化平台API返回字段中英文映射汇总.json'

def load_tdx_field_map():
    """加载通达信字段映射"""
    global TDX_FIELD_MAP
    if TDX_FIELD_MAP is None:
        TDX_FIELD_MAP = {}
        try:
            if TDX_MAP_PATH.exists():
                with open(TDX_MAP_PATH, encoding='utf-8') as f:
                    mapping = json.load(f)
                for section, interfaces in mapping['sections'].items():
                    for name, v in interfaces.items():
                        if isinstance(v, dict) and 'fields' in v:
                            for field, info in v['fields'].items():
                                TDX_FIELD_MAP[field.lower()] = info['cn']
                                TDX_FIELD_MAP[field.upper()] = info['cn']
                                TDX_FIELD_MAP[field] = info['cn']
        except Exception:
            pass
    return TDX_FIELD_MAP
from datetime import datetime
from pathlib import Path

# 让脚本能从 run.py 复用 @meta 解析
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from run import parse_meta, get_all_scripts_meta, BASE_DIR

DB_PATH = str(BASE_DIR / 'db' / 'profit_radar.duckdb')
DICT_PATH = BASE_DIR / 'config' / 'data_dictionary.json'
DOCS_PATH = BASE_DIR / 'docs' / 'data_dict.md'


def parse_field_map_from_script(script_path: Path) -> dict:
    """ast 解析脚本内的 FIELD_MAP 字典字面量 → {col_name: cn_name}
    支持命名: FIELD_MAP / GP_MAPPING / BK_MAPPING / SC_MAPPING
    """
    try:
        tree = ast.parse(script_path.read_text(encoding='utf-8'))
    except Exception:
        return {}

    target_names = {'FIELD_MAP', 'GP_MAPPING', 'BK_MAPPING', 'SC_MAPPING', 'CAT_CN'}
    field_map = {}

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in target_names:
                    name = target.id
                    try:
                        value = ast.literal_eval(node.value)
                    except Exception:
                        continue

                    if name == 'FIELD_MAP' and isinstance(value, dict):
                        # 支持两种格式:
                        # 1. {col_name: {'cn': '...', 'cat': '...'}, ...}
                        # 2. {col_name: '中文名', ...}
                        for k, v in value.items():
                            if isinstance(v, dict) and 'cn' in v:
                                field_map[str(k)] = v['cn']
                            elif isinstance(v, str):
                                field_map[str(k)] = v
                    elif name in ('GP_MAPPING', 'BK_MAPPING', 'SC_MAPPING') and isinstance(value, dict):
                        # {1: {'indicator': 0x01, 'name': '融资融券', ...}, ...}
                        for k, v in value.items():
                            if isinstance(v, dict) and 'name' in v:
                                field_map[f"{name.split('_')[0]}{int(k):02d}"] = v['name']
                    elif name == 'CAT_CN' and isinstance(value, dict):
                        for k, v in value.items():
                            field_map[f"cat_{k}"] = v
    return field_map


def get_table_columns(con, table_name: str) -> list:
    """从 DB DESCRIBE 拉列定义"""
    try:
        df = con.execute(f'DESCRIBE {table_name}').fetchdf()
        return [
            {'name': row['column_name'], 'type': row['column_type']}
            for _, row in df.iterrows()
        ]
    except Exception:
        return []


def get_db_dim_indicators(con) -> dict:
    """拉取 dim_*_indicator 维度表内容 → {table_name: {col_value: cn}}
    用于补充字段中文含义
    """
    dims = {}
    tables = con.execute("SHOW TABLES").fetchdf()['name'].tolist()
    for t in tables:
        if not (t.startswith('dim_') or t.endswith('_indicator')):
            continue
        # 找到中文名列 (启发式: 含 'name' / 'cn' / '名')
        try:
            cols = con.execute(f'DESCRIBE {t}').fetchdf()['column_name'].tolist()
            cn_col = next((c for c in cols if c in ('cn_name', 'gp_name', 'bk_name', 'sc_name', 'field_cn', 'name_cn', 'name')), None)
            key_col = next((c for c in cols if c in ('code', 'gp_code', 'bk_code', 'sc_code', 'field_code', 'indicator')), None)
            if not cn_col or not key_col:
                continue
            df = con.execute(f'SELECT "{key_col}" as k, "{cn_col}" as v FROM {t}').fetchdf()
            dims[t] = dict(zip(df['k'].astype(str), df['v'].astype(str)))
        except Exception:
            continue
    return dims


def build_data_dict() -> dict:
    """构建数据字典"""
    con = duckdb.connect(DB_PATH, read_only=True)
    try:
        scripts_meta = get_all_scripts_meta()
        db_dims = get_db_dim_indicators(con)

        # 加载 tables.json 视图登记（用于视图 fallback）
        tables_meta = {}
        try:
            with open(BASE_DIR / 'config' / 'tables.json', encoding='utf-8') as f:
                tables_meta = json.load(f)
        except Exception:
            pass

        # 收集所有表: 脚本声明的 + DB 实际的
        db_tables = set(con.execute("SHOW TABLES").fetchdf()['name'].tolist())

        # 表类型分类
        is_view = {}
        is_multi = {}  # 一脚本多表
        try:
            view_rows = con.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_type='VIEW'"
            ).fetchall()
            is_view = {r[0] for r in view_rows}
        except Exception:
            pass
        # pianpao 系列一脚本多表
        multi_table_scripts = {
            '70_pianpao_daily': ['pianpao_daily', 'pianpao_daily_summary', 'pianpao_intraday', 'pianpao_intraday_events', 'pianpao_intraday_periods'],
            '71_pianpao_batch': ['pianpao_daily', 'pianpao_daily_summary', 'pianpao_intraday', 'pianpao_intraday_events', 'pianpao_intraday_periods'],
        }

        data_dict = {
            '_meta': {
                'version': '1.1',
                'generated_at': datetime.now().isoformat(timespec='seconds'),
                'note': 'SSOT - 数据字典. 字段中文来源: 脚本FIELD_MAP(ast) > DB dim表 > TODO',
            }
        }

        # 处理脚本声明的表
        for table_name, meta in scripts_meta.items():
            script_path = meta.get('_script_path')
            script_name = script_path.name.replace('.py', '') if script_path else ''
            entry = {
                'cn': meta.get('cn', ''),
                'source_script': str(script_path.relative_to(BASE_DIR)).replace('\\', '/') if script_path else '',
                'dir': meta.get('dir', meta.get('_dir', '')),
                'sort': meta.get('sort', ''),
                'schedule': meta.get('schedule', ''),
                'mode': meta.get('mode', ''),
                'source': meta.get('source', ''),
                'note': meta.get('note', ''),
                'columns': [],
            }
            cols = get_table_columns(con, table_name)
            field_map = parse_field_map_from_script(script_path) if script_path else {}
            for col in cols:
                col_name = col['name']
                cn = field_map.get(col_name, '')
                if not cn:
                    for dim_t, dim_data in db_dims.items():
                        if col_name in dim_data:
                            cn = dim_data[col_name]
                            break
                if not cn:
                    # 查通达信映射
                    tdx_map = load_tdx_field_map()
                    cn = tdx_map.get(col_name) or tdx_map.get(col_name.lower()) or tdx_map.get(col_name.upper())
                if not cn:
                    cn = 'TODO'
                entry['columns'].append({'name': col_name, 'type': col['type'], 'cn': cn, 'note': ''})
            data_dict[table_name] = entry
            db_tables.discard(table_name)

        # 处理多表脚本: 70/71 脚本声明一个表(主表), 但还产出其他4张
        for script_name, tables in multi_table_scripts.items():
            for t in tables:
                if t in db_tables:
                    cols = get_table_columns(con, t)
                    data_dict[t] = {
                        'cn': f'[多表产物-{script_name}]',
                        'source_script': f'2_计算/{script_name}.py',
                        'is_view': t in is_view,
                        'multi_table': True,
                        'columns': [{'name': c['name'], 'type': c['type'], 'cn': 'TODO', 'note': 'pianpao多表产物'} for c in cols],
                    }
                    db_tables.discard(t)

        # 处理 VIEW: *_labeled 自动归到对应主表(非孤儿)
        for t in list(db_tables):
            if t in is_view and t.endswith('_labeled'):
                main = t[:-len('_labeled')]
                if main in data_dict:
                    cols = get_table_columns(con, t)
                    data_dict[t] = {
                        'cn': f'[VIEW] {data_dict[main].get("cn", "")} - 带字段含义',
                        'source_script': data_dict[main].get('source_script', ''),
                        'is_view': True,
                        'derived_from': main,
                        'columns': [{'name': c['name'], 'type': c['type'], 'cn': 'TODO', 'note': '视图, 字段同主表'} for c in cols],
                    }
                    db_tables.discard(t)
                # fallback: 查 tables.json 视图登记项
                elif t in tables_meta:
                    view_meta = tables_meta[t]
                    cols = get_table_columns(con, t)
                    data_dict[t] = {
                        'cn': view_meta.get('cn', t),
                        'source_script': view_meta.get('dir', ''),
                        'is_view': True,
                        'derived_from': view_meta.get('derived_from', ''),
                        'columns': [{'name': c['name'], 'type': c['type'], 'cn': 'TODO', 'note': '视图, 字段含义继承主表'} for c in cols],
                    }
                    db_tables.discard(t)

        # 处理测试/临时表: 标记 [TEST], 不算孤儿但提示
        for t in list(db_tables):
            if t.startswith('test_') or t.startswith('tmp_'):
                cols = get_table_columns(con, t)
                data_dict[t] = {
                    'cn': '[测试/临时表]',
                    'source_script': '',
                    'is_test': True,
                    'columns': [{'name': c['name'], 'type': c['type'], 'cn': 'TODO', 'note': '测试/临时表, 保留作参考'} for c in cols],
                }
                db_tables.discard(t)

        # 处理配套维度表: dim_* 或 *_indicator (除了已处理的test_/tmp_)
        for t in list(db_tables):
            if t.startswith('dim_') or t.endswith('_indicator'):
                cols = get_table_columns(con, t)
                data_dict[t] = {
                    'cn': '[配套维度表]',
                    'source_script': '',
                    'is_dim': True,
                    'columns': [{'name': c['name'], 'type': c['type'], 'cn': 'TODO', 'note': '维度表, 提供枚举/字段含义'} for c in cols],
                }
                db_tables.discard(t)

        # 视图是派生产物(如 *_labeled), 不计入孤儿表
        db_tables -= is_view

        # 外部子系统表 (竞价监控/, 见 memory call-auction-monitor): 不参与 run.py 治理, 不算孤儿
        EXTERNAL_TABLES = {'auction_labels', 'auction_snapshot'}
        for t in list(db_tables):
            if t in EXTERNAL_TABLES:
                cols = get_table_columns(con, t)
                data_dict[t] = {
                    'cn': '[外部子系统-竞价监控]',
                    'source_script': '',
                    'is_external': True,
                    'columns': [{'name': c['name'], 'type': c['type'], 'cn': 'TODO', 'note': '外部子系统表(竞价监控), 不参与run.py治理'} for c in cols],
                }
                db_tables.discard(t)

        # 真正的孤儿: DB有, 上面都没处理
        for t in sorted(db_tables):
            cols = get_table_columns(con, t)
            data_dict[t] = {
                'cn': '[ORPHAN-无脚本]',
                'source_script': '',
                'is_view': t in is_view,
                'orphan': True,
                'columns': [{'name': c['name'], 'type': c['type'], 'cn': 'TODO', 'note': '孤儿表, 待登记或删除'} for c in cols],
            }

        # 兜底: 列名本身是中文时直接作cn; 通用缩写查内置知识库
        for entry in data_dict.values():
            if not isinstance(entry, dict):
                continue
            for c in entry.get('columns', []):
                if c.get('cn') == 'TODO':
                    name = c.get('name', '')
                    if re.search(r'[一-鿿]', name):
                        c['cn'] = name
                    elif name in COMMON_CN:
                        c['cn'] = COMMON_CN[name]
        return data_dict
    finally:
        con.close()


def dict_to_markdown(data_dict: dict) -> str:
    """生成可读 markdown"""
    lines = [
        '# 数据字典 (自动生成)\n',
        f"> 生成时间: {data_dict['_meta']['generated_at']}",
        f"> 来源: 脚本@meta + DB DESCRIBE + 脚本FIELD_MAP(ast) + dim_*维度表\n",
    ]

    # 分类: 正式表 vs 孤儿表
    formal = {k: v for k, v in data_dict.items() if k != '_meta' and not v.get('orphan')}
    orphan = {k: v for k, v in data_dict.items() if v.get('orphan')}

    lines.append(f'## 📊 正式表 ({len(formal)} 个)\n')
    for name, entry in sorted(formal.items(), key=lambda x: (x[1].get('dir', ''), x[1].get('sort', '999'))):
        lines.append(f"### {entry.get('sort', '?')} {name}")
        lines.append(f"- **中文**: {entry.get('cn', '')}")
        lines.append(f"- **脚本**: `{entry.get('source_script', '')}`")
        if entry.get('schedule'):
            lines.append(f"- **schedule**: {entry['schedule']} | **mode**: {entry.get('mode', '')}")
        if entry.get('source'):
            lines.append(f"- **数据源**: {entry['source']}")
        if entry.get('note'):
            lines.append(f"- **备注**: {entry['note']}")
        lines.append(f"\n| 字段 | 类型 | 中文 | 备注 |")
        lines.append(f"|------|------|------|------|")
        for c in entry.get('columns', []):
            lines.append(f"| {c['name']} | {c['type']} | {c['cn']} | {c.get('note', '')} |")
        lines.append('')

    if orphan:
        lines.append(f'\n## ⚠️ 孤儿表 ({len(orphan)} 个, 无对应脚本)\n')
        for name, entry in sorted(orphan.items()):
            lines.append(f"- **{name}** ({len(entry.get('columns', []))} 字段)")
        lines.append('\n> 处理: `python config/gen_data_dict.py --check` 给出建议\n')

    return '\n'.join(lines)


def check_integrity(data_dict: dict) -> list:
    """校验一致性, 返回问题列表"""
    issues = []
    for name, entry in data_dict.items():
        if name == '_meta' or entry.get('orphan'):
            if entry.get('orphan'):
                issues.append(f"[RED] 孤儿表: {name} (DB有, 无脚本) -> DROP 或补脚本")
            continue
        # TODO 字段中文
        todo_cols = [c['name'] for c in entry.get('columns', []) if c['cn'] == 'TODO']
        if todo_cols:
            issues.append(f"[YEL] {name}: {len(todo_cols)} 字段中文待补: {', '.join(todo_cols[:5])}{'...' if len(todo_cols)>5 else ''}")
    return issues


def main():
    ap = argparse.ArgumentParser(description='数据字典生成器/校验器')
    ap.add_argument('--sync', action='store_true', help='同步生成 data_dictionary.json + docs/data_dict.md')
    ap.add_argument('--check', action='store_true', help='只校验不写')
    args = ap.parse_args()

    if not (args.sync or args.check):
        args.sync = True  # 默认 sync

    print('=' * 60)
    print('数据字典生成器')
    print('=' * 60)

    data_dict = build_data_dict()
    n = len(data_dict) - 1  # 去掉 _meta
    n_orphan = sum(1 for v in data_dict.values() if v.get('orphan'))
    print(f'收集: {n} 个表 (孤儿: {n_orphan})')

    issues = check_integrity(data_dict)
    print(f'问题: {len(issues)} 个')

    if args.check:
        if issues:
            for i in issues[:20]:
                print(f'  {i}')
            if len(issues) > 20:
                print(f'  ... 还有 {len(issues)-20} 个')
        else:
            print('[OK] 无问题')
        return

    # 写文件
    DICT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DICT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data_dict, f, ensure_ascii=False, indent=2)
    print(f'[OK] {DICT_PATH}')

    DOCS_PATH.parent.mkdir(parents=True, exist_ok=True)
    md = dict_to_markdown(data_dict)
    with open(DOCS_PATH, 'w', encoding='utf-8') as f:
        f.write(md)
    print(f'[OK] {DOCS_PATH}')

    if issues:
        print('\n[!] 警告 (非阻塞):')
        for i in issues[:10]:
            print(f'  {i}')


if __name__ == '__main__':
    main()
