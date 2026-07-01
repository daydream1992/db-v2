"""竞价监控雷达 v2 — 数据层

架构(避免开盘掉链子):
  盘前 prepare_preset: 动态池+DB 4表特征+置信度,落盘 preset parquet(开盘前做好)
  开盘 fetch_open_snapshot: 9:25 后唯一实时步骤(取开盘价)
  开盘 load_preset: 读本地 preset(零延时),merge 开盘价即可

日期严谨:T-1 取"今天之前的最新交易日",不乱取;数据缺失/滞后→置信度降。
"""
from __future__ import annotations

import sys
import time as _time
from datetime import date, datetime, time as dtime

import pandas as pd
from loguru import logger

TQ_SYS_PATH = r"K:\txdlianghua\PYPlugins\sys"
if TQ_SYS_PATH not in sys.path:
    sys.path.insert(0, TQ_SYS_PATH)
try:
    from tqcenter import tq  # type: ignore
except Exception as e:  # noqa: BLE001
    tq = None  # type: ignore
    logger.warning(f"tqcenter 加载失败: {e}")

from config import CONFIG, THRESHOLDS, limit_up_pct


# ============ 自选池 ============
def load_pool(path) -> list[str]:
    if not path.exists():
        return []
    codes: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip().split("#", 1)[0].strip()
        if s:
            codes.append(s)
    return list(dict.fromkeys(codes))


# ============ L1:开盘价快照(9:25 后,唯一实时步骤) ============
def _safe_snapshot(code: str, max_retry: int = 3) -> dict:
    if tq is None:
        return {}
    for attempt in range(1, max_retry + 1):
        try:
            d = tq.get_market_snapshot(stock_code=code, field_list=[])
            if d:  # 有返回即可(ErrorId 实际是 str "0",==0(int) 恒 False;有效性由调用方 now>0 判断)
                return d
        except Exception:  # noqa: BLE001
            _time.sleep(0.2 * attempt)
    return {}


def fetch_open_snapshot(codes: list[str]) -> pd.DataFrame:
    """9:25 撮合后取开盘价。返回 code/last_close/open_price/amount"""
    if tq is None:
        raise RuntimeError("tqcenter 未加载")
    tq.initialize(__file__)
    rows: list[dict] = []
    try:
        for i, code in enumerate(codes, 1):
            d = _safe_snapshot(code)
            if not d:
                continue
            try:
                last_close = float(d.get("LastClose", 0) or 0)
                open_p = float(d.get("Open", 0) or 0)
                now_p = float(d.get("Now", 0) or 0)
                volume = int(float(d.get("Volume", 0) or 0))
                amount = float(d.get("Amount", 0) or 0)
            except (TypeError, ValueError):
                continue
            if last_close <= 0 or open_p <= 0:
                continue  # Open=撮合开盘价;撮合前 Open=0 跳过(实时/盘后 Open 都在)
            rows.append({"code": code, "last_close": last_close,
                         "open_price": open_p, "now_price": now_p,
                         "volume": volume, "amount": amount})
            if i % 50 == 0:
                logger.debug(f"  snapshot {i}/{len(codes)}")
    finally:
        try:
            tq.close()
        except Exception:  # noqa: BLE001
            pass
    logger.info(f"开盘快照取到 {len(rows)}/{len(codes)}")
    return pd.DataFrame(rows)


# ============ L2:DB 多维特征(T-1) ============
def fetch_db_features(codes: list[str], con, th: THRESHOLDS) -> pd.DataFrame:
    """4 表 merge,全取 T-1(今天之前的最新交易日)"""
    today_str = date.today().strftime("%Y%m%d")
    df = pd.DataFrame({"code": codes})

    turn = con.execute("""
        SELECT code, pct_chg AS yest_pct, turnover AS yest_turnover
        FROM stock_daily_turnover
        WHERE date = (SELECT MAX(date) FROM stock_daily_turnover WHERE date < CURRENT_DATE)
    """).fetchdf()
    df = df.merge(turn, on="code", how="left")

    zjl = con.execute(f"""
        SELECT code, CAST(Zjl AS DOUBLE) AS zjl
        FROM sjb_api_plhqL2kz_88zd
        WHERE CAST(HqDate AS VARCHAR) = (
            SELECT MAX(CAST(HqDate AS VARCHAR)) FROM sjb_api_plhqL2kz_88zd
            WHERE CAST(HqDate AS VARCHAR) < '{today_str}')
    """).fetchdf()
    df = df.merge(zjl, on="code", how="left")

    cap = con.execute("""
        SELECT code, ltgb FROM capital_info
        QUALIFY ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) = 1
    """).fetchdf()
    df = df.merge(cap, on="code", how="left")

    piano = con.execute(f"""
        SELECT stock_code, COUNT(*) AS trap_cnt,
               MAX(trade_date) AS last_trap, MAX(severity) AS max_sev
        FROM pianpao_daily
        WHERE trap_confirmed = true
          AND trade_date >= CURRENT_DATE - INTERVAL '{th.pianpao_recent_days} days'
        GROUP BY stock_code
    """).fetchdf().rename(columns={"stock_code": "code"})
    df = df.merge(piano, on="code", how="left")
    df["trap_cnt"] = df["trap_cnt"].fillna(0).astype(int)
    return df


# ============ L3:动态池 ============
def build_dynamic_pool(con, pool_codes: list[str]) -> list[str]:
    df = con.execute("""
        SELECT code, pct_chg FROM stock_daily_turnover
        WHERE date = (SELECT MAX(date) FROM stock_daily_turnover WHERE date < CURRENT_DATE)
    """).fetchdf()
    limit_up: list[str] = []
    for _, r in df.iterrows():
        pct = r["pct_chg"]
        if pd.isna(pct):
            continue
        if pct >= limit_up_pct(r["code"]) - 0.2:
            limit_up.append(r["code"])
    logger.info(f"昨日涨停 {len(limit_up)} 只")
    all_codes = list(dict.fromkeys(limit_up + list(pool_codes)))
    logger.info(f"动态池 {len(all_codes)} 只(涨停{len(limit_up)}+自选{len(pool_codes)})")
    return all_codes


# ============ L4:异常过滤 ============
def filter_abnormal(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)
    out = df[df["yest_pct"].notna()].reset_index(drop=True)
    dropped = before - len(out)
    if dropped:
        logger.info(f"剔除 T-1 缺失 {dropped} 只(停牌/新股)")
    return out


# ============ 数据新鲜度(日期严谨) ============
def check_data_freshness(con) -> dict:
    """检查各表最新日期 vs 期望 T-1。日期不乱取,记录实际数据日期+滞后"""
    turn_max = con.execute(
        "SELECT MAX(date) FROM stock_daily_turnover WHERE date < CURRENT_DATE"
    ).fetchone()[0]
    today_str = date.today().strftime("%Y%m%d")
    sjb_raw = con.execute(
        f"SELECT MAX(CAST(HqDate AS VARCHAR)) FROM sjb_api_plhqL2kz_88zd "
        f"WHERE CAST(HqDate AS VARCHAR) < '{today_str}'"
    ).fetchone()[0]

    turn_d = turn_max.date() if hasattr(turn_max, "date") else turn_max
    sjb_d = None
    if sjb_raw:
        try:
            sjb_d = datetime.strptime(str(sjb_raw), "%Y%m%d").date()
        except ValueError:
            sjb_d = None

    data_date = turn_d
    lag = (date.today() - data_date).days if data_date else 99
    consistent = bool(sjb_d and turn_d and sjb_d == turn_d)
    return {
        "data_date": str(data_date) if data_date else "N/A",
        "turnover_date": str(turn_d) if turn_d else "N/A",
        "sjb_date": str(sjb_d) if sjb_d else "N/A",
        "lag_days": lag,
        "consistent": consistent,
    }


def _row_confidence(row, fresh: dict) -> tuple[str, str]:
    """单票置信度:字段完整性 + 数据滞后。high/medium/low + 原因"""
    reasons: list[str] = []
    if pd.isna(row.get("zjl")):
        reasons.append("主力净额缺")
    if pd.isna(row.get("yest_pct")):
        reasons.append("昨日涨幅缺")
    if pd.isna(row.get("ltgb")):
        reasons.append("流通股本缺")
    if fresh.get("lag_days", 0) >= 4:  # 周末 lag=3 正常,>=4 算滞后
        reasons.append(f"数据滞后{fresh['lag_days']}天")
    if not reasons:
        return "high", ""
    level = "low" if (len(reasons) >= 2 or fresh.get("lag_days", 0) >= 4) else "medium"
    return level, ";".join(reasons)


# ============ 盘前预备(开盘前做好) ============
def prepare_preset(con, th: THRESHOLDS) -> dict:
    """盘前预备:动态池+DB特征+置信度,落盘 preset parquet。

    开盘后只需 load_preset + fetch_open_snapshot,9:25 不再依赖 DB。
    """
    pool = load_pool(CONFIG.pool_path)
    codes = build_dynamic_pool(con, pool)
    fresh = check_data_freshness(con)
    logger.info(f"数据日期={fresh['data_date']} 滞后{fresh['lag_days']}天 "
                f"turnover/sjb一致={fresh['consistent']}")

    db_df = fetch_db_features(codes, con, th)
    # 预计算昨日涨停(板块涨停幅度)
    db_df["yest_limit_up"] = db_df.apply(
        lambda r: pd.notna(r.get("yest_pct"))
        and r["yest_pct"] >= limit_up_pct(r["code"]) - 0.2, axis=1)
    # 置信度
    conf = db_df.apply(lambda r: _row_confidence(r, fresh), axis=1)
    db_df["confidence"], db_df["confidence_reason"] = zip(*conf)
    db_df["data_date"] = fresh["data_date"]

    CONFIG.output_dir.mkdir(parents=True, exist_ok=True)
    today = date.today().strftime("%Y%m%d")
    path = CONFIG.output_dir / f"preset_{today}.parquet"
    db_df.to_parquet(path, index=False)

    dist = db_df["confidence"].value_counts().to_dict()
    logger.success(f"盘前预备落盘 {path}: {len(db_df)}只 置信度{dist}")
    return {"path": str(path), "fresh": fresh, "count": len(db_df), "confidence": dist}


def load_preset(run_date: str | None = None) -> pd.DataFrame:
    """开盘后读 preset(本地读取零延时)。返回 DB特征+置信度+data_date"""
    d = run_date or date.today().strftime("%Y%m%d")
    path = CONFIG.output_dir / f"preset_{d}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"找不到盘前预备包 {path},请先跑 python main.py --prepare")
    df = pd.read_parquet(path)
    data_date = df["data_date"].iloc[0] if "data_date" in df.columns else "?"
    logger.info(f"读盘前预备包 {path}: {len(df)}只 数据日期={data_date}")
    return df


# ============ 竞价趋势:循环采样 9:15-9:25 ============

def _wait_until(target: dtime, slack_s: float = 0.5) -> None:
    """等到目标时刻(已过立即返回)"""
    now = datetime.now()
    now_s = now.hour * 3600 + now.minute * 60 + now.second
    tgt_s = target.hour * 3600 + target.minute * 60 + target.second
    delta = tgt_s - now_s
    if delta <= -slack_s:
        return
    if delta > 0:
        logger.info(f"等待到 {target} (还差 {delta:.0f}s)")
        _time.sleep(max(0.0, delta - slack_s))


def fetch_price_series(codes: list[str], sample_times: tuple) -> dict:
    """循环抓取:每个采样时刻取所有票现价。

    返回 {code: [(idx, ts, price, pct), ...]}
    撮合前 Now=0 → pct=None(拟合时忽略)
    """
    if tq is None:
        raise RuntimeError("tqcenter 未加载")
    tq.initialize(__file__)
    series: dict[str, list] = {c: [] for c in codes}
    try:
        for idx, t in enumerate(sample_times):
            _wait_until(t)
            ts = datetime.now()
            got = 0
            for code in codes:
                d = _safe_snapshot(code)
                if not d:
                    series[code].append((idx, ts, 0.0, None))
                    continue
                try:
                    last_close = float(d.get("LastClose", 0) or 0)
                    price = float(d.get("Now", 0) or 0)
                except (TypeError, ValueError):
                    last_close, price = 0.0, 0.0
                pct = ((price - last_close) / last_close * 100) if (last_close > 0 and price > 0) else None
                series[code].append((idx, ts, price, pct))
                if pct is not None:
                    got += 1
            logger.info(f"采样 {idx + 1}/{len(sample_times)} @ {ts:%H:%M:%S} 有效 {got}/{len(codes)}")
    finally:
        try:
            tq.close()
        except Exception:  # noqa: BLE001
            pass
    return series
