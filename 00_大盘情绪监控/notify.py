#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""notify.py — 00大盘情绪监控 飞书推送
    复用 01实盘监控 的 urllib POST 实现(标准库,无新依赖)。
    每帧把完整快照文本推一次(5分钟一帧,不算轰炸)。
    webhook 从同目录 feishu_webhook.txt 读(空则跳过,只本地终端输出)。
"""
from __future__ import annotations
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

# webhook 配置文件(同目录,.gitignore 排除防泄露 token)
WEBHOOK_FILE = Path(__file__).resolve().parent / "feishu_webhook.txt"


def load_webhook() -> str | None:
    """读 feishu_webhook.txt。不存在/空 → None(跳过推送)"""
    if not WEBHOOK_FILE.exists():
        return None
    s = WEBHOOK_FILE.read_text(encoding="utf-8").strip()
    return s or None


def push_text(text: str, webhook: str | None = None, max_retry: int = 3) -> bool:
    """推一条文本到飞书。
       webhook 为 None 时自动 load_webhook();仍空则跳过返 False。
       True=推送成功;False=跳过/失败。"""
    if webhook is None:
        webhook = load_webhook()
    if not webhook or not text:
        return False
    payload = {"msg_type": "text", "content": {"text": text}}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    for attempt in range(1, max_retry + 1):
        try:
            req = urllib.request.Request(
                webhook, data=data,
                headers={"Content-Type": "application/json"}, method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            # 飞书成功返回 StatusCode=0 或 code=0
            if result.get("StatusCode") == 0 or result.get("code") == 0:
                return True
        except (urllib.error.URLError, TimeoutError):
            time.sleep(1.0)
        except Exception:
            time.sleep(1.0)
    return False
