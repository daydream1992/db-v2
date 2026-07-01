#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""db.py — 大盘情绪监控 持久化层(SQLite + WAL,标准库,单文件)
    3 表:
      snapshot_min   盘中分钟级快照(每 1-3 分钟一条,画情绪分时图)
      event_log      事件触发(变盘/情绪跨越/高标炸板,带详细快照 JSON)
      daily_summary  盘后归档(每日一条,跨日统计)
    DB:sentiment.db(本目录,单文件,零配置)
    并发:WAL 模式,读不阻塞写,写不阻塞读(daemon 写 + 你随时查,互不卡)
"""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / 'sentiment.db'

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshot_min (
    date        TEXT NOT NULL,
    ts          TEXT NOT NULL,
    zt_cnt      INTEGER,
    dt_cnt      INTEGER,
    udr         REAL,
    fbl         REAL,
    max_lb      INTEGER,
    emotion     TEXT,
    top_sectors TEXT,
    lb_tier     TEXT,
    PRIMARY KEY (date, ts)
);

CREATE TABLE IF NOT EXISTS event_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time   TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    event_detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_time ON event_log(event_time);

CREATE TABLE IF NOT EXISTS daily_summary (
    date             TEXT PRIMARY KEY,
    emotion          TEXT,
    zt_cnt           INTEGER,
    dt_cnt           INTEGER,
    zhaban_cnt       INTEGER,
    fbl              REAL,
    max_lb           INTEGER,
    lb_cnt           INTEGER,
    mainline_sectors TEXT,
    retreat_sectors  TEXT,
    lb_tier_final    TEXT,
    events_count     INTEGER
);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)  # 写锁等 10s 不立刻报错
    conn.execute("PRAGMA journal_mode=WAL")  # WAL:读不阻塞写,写不阻塞读
    conn.execute("PRAGMA synchronous=NORMAL")  # WAL 下安全,比 FULL 快
    conn.executescript(SCHEMA)
    return conn


def insert_snapshot(date: str, ts: str, zt_cnt: int, dt_cnt: int, udr: float,
                    fbl: float, max_lb: int, emotion: str,
                    top_sectors: list, lb_tier: list) -> None:
    """分钟级快照。top_sectors/lb_tier 存 JSON。
       INSERT OR REPLACE:同 date+ts 重跑覆盖"""
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO snapshot_min VALUES (?,?,?,?,?,?,?,?,?,?)",
            (date, ts, zt_cnt, dt_cnt, round(udr, 4), round(fbl, 2), max_lb, emotion,
             json.dumps(top_sectors, ensure_ascii=False),
             json.dumps(lb_tier, ensure_ascii=False)),
        )


def insert_event(event_time: str, event_type: str, detail: dict) -> None:
    """事件记录(变盘/跨越/高标炸板)。detail 存 JSON"""
    with _conn() as c:
        c.execute(
            "INSERT INTO event_log (event_time, event_type, event_detail) VALUES (?,?,?)",
            (event_time, event_type, json.dumps(detail, ensure_ascii=False)),
        )


def upsert_daily(date: str, emotion: str, zt_cnt: int, dt_cnt: int, zhaban_cnt: int,
                 fbl: float, max_lb: int, lb_cnt: int,
                 mainline_sectors: list, retreat_sectors: list,
                 lb_tier_final: list, events_count: int) -> None:
    """盘后归档(每日一条,覆盖)"""
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO daily_summary VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (date, emotion, zt_cnt, dt_cnt, zhaban_cnt, round(fbl, 2), max_lb, lb_cnt,
             json.dumps(mainline_sectors, ensure_ascii=False),
             json.dumps(retreat_sectors, ensure_ascii=False),
             json.dumps(lb_tier_final, ensure_ascii=False),
             events_count),
        )


# ─── 查询(盘后复盘用)───
def query_events(date: str) -> list[dict]:
    """查某日全部事件"""
    with _conn() as c:
        rows = c.execute(
            "SELECT event_time, event_type, event_detail FROM event_log "
            "WHERE event_time LIKE ? ORDER BY event_time",
            (f"{date}%",),
        ).fetchall()
    return [{'event_time': r[0], 'event_type': r[1], 'event_detail': r[2]} for r in rows]


def query_snapshots(date: str) -> list[dict]:
    """查某日全部分钟快照(画分时图)"""
    with _conn() as c:
        rows = c.execute(
            "SELECT ts, zt_cnt, dt_cnt, udr, fbl, max_lb, emotion "
            "FROM snapshot_min WHERE date=? ORDER BY ts",
            (date,),
        ).fetchall()
    return [{'ts': r[0], 'zt_cnt': r[1], 'dt_cnt': r[2], 'udr': r[3],
             'fbl': r[4], 'max_lb': r[5], 'emotion': r[6]} for r in rows]


if __name__ == '__main__':
    _conn().close()
    print(f"DB: {DB_PATH}")
    with _conn() as c:
        mode = c.execute("PRAGMA journal_mode").fetchone()[0]
        print(f"  journal_mode = {mode}")
        for t in ['snapshot_min', 'event_log', 'daily_summary']:
            n = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"  {t}: {n} 行")
