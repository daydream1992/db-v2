"""竞价监控雷达 — 飞书推送桩 (L4.通知)

当前状态: 桩函数,NotImplementedError。
main.py 调用处已用 try/except 捕获,不会让程序崩溃。

TODO(用户实现):
1. 填入 webhook URL(建议从 .env 读 FEISHU_WEBHOOK_AUCTION)
2. 实现签名校验(若启用了加签)
3. 频控 1s 间隔(避免触发飞书限流)
4. 失败重试 3 次
5. 消息卡片格式(rich Table 转 markdown 表格)
"""
from __future__ import annotations

from loguru import logger


def push_feishu(rows: list[dict], webhook_url: str | None = None) -> bool:
    """推送 TOP N 至飞书机器人。

    Args:
        rows: ScoredRow 列表(或 dict 列表),每行含 code/score/mode/reason/pct
        webhook_url: 飞书机器人 webhook URL,None 则不推送

    Returns:
        True 推送成功;False 跳过或失败

    Raises:
        NotImplementedError: 桩函数,业务未实现
    """
    if not webhook_url:
        logger.warning("飞书推送未配置 webhook_url(在 CONFIG.feishu_webhook 设置),跳过")
        return False

    raise NotImplementedError(
        "待补: 飞书 webhook + 卡片格式 + 频控 + 重试。"
        "建议: 从 .env 读 FEISHU_WEBHOOK_AUCTION;"
        "用 requests.post + 1s 间隔 + 3 次重试;"
        "消息体用飞书 card 格式(标题/字段/表格)"
    )
