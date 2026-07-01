#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""eod_run.py — 盘后归档(16:00 后一次性)
    盘中全套逻辑 + 盘后独有:
      get_scjy_value(['SC15','SC24','SC03','SC04'])  封板资金 + 剔ST权威涨跌停
      get_bkjy_value(板块, BK9/BK12/BK13/BK14)        板块曾涨跌停 + 2板以上
    状态:盘后单独跑时无 daemon 状态,首封/变盘 留空(只有 daemon 跑过才有)
    输出: output/eod/sentiment_eod_YYYYMMDD.csv(主表)
          output/eod/sectors_YYYYMMDD.csv(板块明细)
          output/eod/pools_YYYYMMDD.csv(6 池个股)
"""
from __future__ import annotations
import sys
import csv
import datetime as dt
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import _common  # noqa: E402
import index_monitor, sector_monitor, stock_monitor  # noqa: E402
import sector_meta  # noqa: E402
from state_cache import StateCache  # noqa: E402

TODAY_STR = dt.date.today().strftime('%Y%m%d')
OUTPUT_DIR = SCRIPT_DIR / 'output' / 'eod'


def step_scjy(tq) -> dict:
    res = tq.get_scjy_value(field_list=['SC15', 'SC24', 'SC03', 'SC04'])

    def last(fid):
        v = res.get(fid, [])
        return v[-1].get('Value') if v else None
    sc15 = last('SC15') or ['0', '0']
    sc24 = last('SC24') or ['0', '0']
    sc03 = last('SC03') or ['0', '0']
    sc04 = last('SC04') or ['0', '0']
    return {
        '封板成功资金万': float(sc15[0]), '封板失败资金万': float(sc15[1]),
        '涨停不含ST': int(float(sc24[0])), '跌停不含ST': int(float(sc24[1])),
        '涨停含ST': int(float(sc03[0])), '曾涨停': int(float(sc03[1])),
        '跌停含ST': int(float(sc04[0])), '曾跌停': int(float(sc04[1])),
    }


def step_bkjy(tq, sectors: list) -> dict:
    res = tq.get_bkjy_value(stock_list=sectors, field_list=['BK9', 'BK12', 'BK13', 'BK14'],
                            start_time=TODAY_STR, end_time=TODAY_STR)
    out = {}
    for code, blk in res.items():
        if code == 'ErrorId' or not isinstance(blk, dict):
            continue

        def last(fid):
            v = blk.get(fid, [])
            return v[-1].get('Value') if v else None
        out[code] = {'BK12': last('BK12'), 'BK13': last('BK13'), 'BK14': last('BK14')}
    return out


def main() -> int:
    print(f"=== 盘后归档 {TODAY_STR} ===")
    if not _common.init_tq(__file__):
        return 1
    tq = _common.get_tq()
    state = StateCache()  # 盘后单独跑:状态空(首封/变盘 无)

    # 3 层
    idx = index_monitor.collect(tq)
    sh, sz = idx.get('999999.SH', {}), idx.get('399001.SZ', {})
    sectors_all = tq.get_sector_list(list_type=0)
    sec_rows = sector_monitor.collect(tq, sectors_all)
    sector_monitor.tag_block_type_static(sec_rows)  # 静态查表(替代运行时 get_relation)
    index_zaf = sh.get('zaf', 0)
    max_flow = max((abs(r['zjl']) for r in sec_rows), default=1) or 1
    sec_ranked = sector_monitor.rank(sec_rows, index_zaf, max_flow)

    stocks = tq.get_stock_list()
    pools, all_zaf = stock_monitor.collect(tq, stocks, state, '15:00:00')
    n_zt = len(pools['首板']) + len(pools['连板梯队'])
    n_dt = len(pools['跌停池'])
    n_zhaban = len(pools['炸板风险'])
    fbl = n_zt / (n_zt + n_zhaban) * 100 if (n_zt + n_zhaban) else 0
    max_lb = max((r['lb'] for r in pools['连板梯队']), default=0)
    udr = (sh.get('up', 0) + sz.get('up', 0)) / max(1, sh.get('down', 0) + sz.get('down', 0))
    emo = index_monitor.rate_emotion(n_zt, round(fbl, 2), max_lb, round(udr, 2))

    # 盘后独有
    try:
        sc = step_scjy(tq)
    except Exception as e:
        print(f"SCJY 异常: {e}"); sc = {}
    try:
        bk = step_bkjy(tq, sectors_all)
    except Exception as e:
        print(f"BKJY 异常: {e}"); bk = {}

    # 落盘
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 主表
    with open(OUTPUT_DIR / f"sentiment_eod_{TODAY_STR}.csv", 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f); w.writerow(['date', '指标', '值'])
        rows = [
            ('情绪评级', emo['rating']), ('评级明细', emo['detail']),
            ('沪涨家数', sh.get('up', 0)), ('沪跌家数', sh.get('down', 0)),
            ('深涨家数', sz.get('up', 0)), ('深跌家数', sz.get('down', 0)),
            ('沪涨幅%', sh.get('zaf', 0)), ('深涨幅%', sz.get('zaf', 0)),
            ('沪主力净额万', sh.get('zjl', 0)), ('深主力净额万', sz.get('zjl', 0)),
            ('涨停数_FCAmo', n_zt), ('跌停数_FCAmo', n_dt), ('炸板数', n_zhaban),
            ('封板率%', round(fbl, 2)), ('最高连板', max_lb),
            ('连板股数', len(pools['连板梯队'])), ('首板数', len(pools['首板'])),
            ('易炸预警', len(pools['易炸预警'])), ('A杀跌停', sum(1 for r in pools['跌停池'] if r.get('a_sha'))),
        ]
        for k, v in sc.items():
            rows.append((k, v))
        for k, v in rows:
            w.writerow([TODAY_STR, k, v])

    # 板块明细
    with open(OUTPUT_DIR / f"sectors_{TODAY_STR}.csv", 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['板块代码', '类型', '名称', '涨家数', '跌家数', '涨停家数', '涨幅%',
                    '主力万', '5日%', '20日%', '60日%', '强度分', '主线', 'BK14_2板以上'])
        for r in sec_ranked:
            b = bk.get(r['code'], {})
            w.writerow([r['code'], r['btype'], r['name'], r['up'], r['down'], r['zt_num'],
                        r['zaf'], r['zjl'], r['zaf_pre5'], r['zaf_pre20'], r['zaf_pre60'],
                        round(r['score'], 2), '是' if r['is_mainline'] else '',
                        b.get('BK14', '')])

    # 6 池(补三级行业 + 名称)
    with open(OUTPUT_DIR / f"pools_{TODAY_STR}.csv", 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['池子', 'code', '名称', '行业一级', '行业二级', '行业三级',
                    '连板数', '涨幅%', '封单额万', '封成比', '主力万', '首封时间', 'A杀'])
        for pool_name, items in pools.items():
            for r in items:
                code = r.get('code', '')
                ind1, ind2, ind3 = sector_meta.stock_industry3(code)
                w.writerow([pool_name, code, sector_meta.stock_name(code), ind1, ind2, ind3,
                            r.get('lb', 0), r.get('zaf', 0), r.get('fcamo', 0), r.get('fcb', 0),
                            r.get('zjl', 0), r.get('first_zt_time', ''), '是' if r.get('a_sha') else ''])

    # 三级板块明细:把板块按"三级行业"重新聚合(用行业板块的三级下属)
    # 行业板块本身是申万体系,这里用 stock_to_ind3 反推每只股的三级,聚合成三级板块强度
    ind3_agg: dict[str, dict] = {}  # 三级名 → {zaf, zjl, zt_cnt, n}
    for r in pools['连板梯队'] + pools['首板']:
        code = r.get('code', '')
        ind1, ind2, ind3 = sector_meta.stock_industry3(code)
        if not ind3:
            continue
        d = ind3_agg.setdefault(ind3, {'ind1': ind1, 'ind2': ind2, 'zt_cnt': 0, 'lb_cnt': 0, 'zjl': 0.0})
        d['zt_cnt'] += 1
        d['lb_cnt'] += r.get('lb', 0)
        d['zjl'] += r.get('zjl', 0)
    with open(OUTPUT_DIR / f"industry3_{TODAY_STR}.csv", 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['行业一级', '行业二级', '行业三级', '涨停家数', '连板总数', '主力净额万'])
        for ind3, d in sorted(ind3_agg.items(), key=lambda x: x[1]['zt_cnt'], reverse=True):
            w.writerow([d['ind1'], d['ind2'], ind3, d['zt_cnt'], d['lb_cnt'], round(d['zjl'], 2)])

    # 概念题材温度榜(涨停股按概念聚合)
    concept_codes = set(sector_meta.all_block_codes('概念'))
    hot = sector_monitor.concept_hot_board(pools['连板梯队'], pools['首板'], concept_codes)
    with open(OUTPUT_DIR / f"concept_hot_{TODAY_STR}.csv", 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['概念板块代码', '概念', '涨停家数', '连板股数', '连板总高'])
        for r in hot[:50]:  # Top50 题材
            w.writerow([r['code'], r['name'], r['zt_cnt'], r['lb_cnt'], r['lb_sum']])

    # 行业×概念共振买点(主线行业+主线概念双强)
    mainline_codes = {r['code'] for r in sec_ranked if r['is_mainline']}
    resonate = sector_monitor.detect_industry_concept_resonance(
        pools['连板梯队'], pools['首板'], mainline_codes)
    with open(OUTPUT_DIR / f"resonance_{TODAY_STR}.csv", 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['code', '名称', '连板数', '主线行业', '主线概念'])
        for r in resonate:
            w.writerow([r['code'], r['name'], r['lb'], '|'.join(r['行业']), '|'.join(r['概念'])])

    print(f"\n情绪: {emo['rating']}")
    print(f"涨停{n_zt} 跌停{n_dt} 炸板{n_zhaban} 封板率{fbl:.1f}% 最高连板{max_lb}")
    print(f"3源: FCAmo涨停{n_zt} / SC03含ST{sc.get('涨停含ST','?')} / SC24剔ST{sc.get('涨停不含ST','?')}")
    print(f"输出: {OUTPUT_DIR}/sentiment_eod_{TODAY_STR}.csv + sectors + pools")

    # 盘后也 flush 状态(本帧)
    state.push_frame({'ts': '15:00:00', 'zt_cnt': n_zt, 'udr': round(udr, 2),
                      'fbl': round(fbl, 2), 'max_lb': max_lb})
    state.flush(OUTPUT_DIR)

    try:
        tq.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
