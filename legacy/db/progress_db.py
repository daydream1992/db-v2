"""
独立的进度数据库管理 - 避免与主数据库冲突
使用SQLite存储进度信息
"""

import sqlite3
import json
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, List

logger = logging.getLogger("progress_db")

PROGRESS_DB_PATH = Path(__file__).resolve().parent / "progress_monitor.db"


def get_progress_connection():
    """获取进度数据库连接"""
    conn = sqlite3.connect(str(PROGRESS_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_progress_db():
    """初始化进度数据库"""
    conn = get_progress_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS pipeline_progress (
            task_name TEXT PRIMARY KEY,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL,
            total_count INTEGER NOT NULL DEFAULT 0,
            processed_count INTEGER NOT NULL DEFAULT 0,
            last_update TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            error_message TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            progress_percent REAL DEFAULT 0.0,
            metadata TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS pipeline_progress_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_name TEXT NOT NULL,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL,
            total_count INTEGER NOT NULL,
            processed_count INTEGER NOT NULL,
            progress_percent REAL NOT NULL,
            duration_seconds INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            metadata TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_progress_history_time 
        ON pipeline_progress_history(start_time DESC)
    """)

    conn.commit()
    conn.close()
    logger.info("进度数据库初始化完成: %s", PROGRESS_DB_PATH)


class ProgressDB:
    """进度数据库操作类"""

    def __init__(self):
        init_progress_db()

    def save_progress(self, task_name: str, task_type: str, status: str,
                     total_count: int, processed_count: int,
                     progress_percent: float, last_update: str,
                     start_time: str, end_time: str = None,
                     error_message: str = None, metadata: dict = None):
        """保存或更新任务进度"""
        conn = get_progress_connection()
        cursor = conn.cursor()

        metadata_json = json.dumps(metadata) if metadata else None

        cursor.execute("""
            INSERT INTO pipeline_progress (
                task_name, task_type, status, total_count, processed_count,
                progress_percent, last_update, start_time, end_time,
                error_message, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(task_name) DO UPDATE SET
                status = excluded.status,
                total_count = excluded.total_count,
                processed_count = excluded.processed_count,
                progress_percent = excluded.progress_percent,
                last_update = excluded.last_update,
                end_time = excluded.end_time,
                error_message = excluded.error_message,
                metadata = excluded.metadata
        """, (task_name, task_type, status, total_count, processed_count,
              progress_percent, last_update, start_time, end_time,
              error_message, metadata_json))

        conn.commit()
        conn.close()

    def get_progress(self, task_name: str = None) -> Optional[Dict] or List[Dict]:
        """获取任务进度"""
        conn = get_progress_connection()
        cursor = conn.cursor()

        if task_name:
            cursor.execute("SELECT * FROM pipeline_progress WHERE task_name = ?", (task_name,))
            row = cursor.fetchone()
            conn.close()
            if row:
                return dict(row)
            return None
        else:
            cursor.execute("SELECT * FROM pipeline_progress")
            rows = cursor.fetchall()
            conn.close()
            return [dict(row) for row in rows]

    def delete_progress(self, task_name: str):
        """删除任务进度"""
        conn = get_progress_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM pipeline_progress WHERE task_name = ?", (task_name,))
        conn.commit()
        conn.close()

    def save_history(self, task_name: str, task_type: str, status: str,
                    total_count: int, processed_count: int,
                    progress_percent: float, duration_seconds: int,
                    start_time: str, end_time: str, metadata: dict = None):
        """保存到历史记录"""
        conn = get_progress_connection()
        cursor = conn.cursor()

        metadata_json = json.dumps(metadata) if metadata else None

        cursor.execute("""
            INSERT INTO pipeline_progress_history (
                task_name, task_type, status, total_count, processed_count,
                progress_percent, duration_seconds, start_time, end_time, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (task_name, task_type, status, total_count, processed_count,
              progress_percent, duration_seconds, start_time, end_time, metadata_json))

        conn.commit()
        conn.close()

    def get_history(self, page: int = 1, page_size: int = 20,
                   start_date: str = None, task_name: str = None) -> Dict:
        """获取历史记录"""
        conn = get_progress_connection()
        cursor = conn.cursor()

        conditions = []
        params = []

        if start_date:
            conditions.append("start_time >= ?")
            params.append(start_date)

        if task_name:
            conditions.append("task_name LIKE ?")
            params.append(f"%{task_name}%")

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        cursor.execute(f"SELECT COUNT(*) FROM pipeline_progress_history WHERE {where_clause}", params)
        total = cursor.fetchone()[0]

        offset = (page - 1) * page_size
        params.extend([page_size, offset])

        cursor.execute(f"""
            SELECT * FROM pipeline_progress_history
            WHERE {where_clause}
            ORDER BY start_time DESC
            LIMIT ? OFFSET ?
        """, params)

        rows = cursor.fetchall()
        conn.close()

        return {
            'total': total,
            'page': page,
            'page_size': page_size,
            'pages': (total + page_size - 1) // page_size if total > 0 else 0,
            'history': [dict(row) for row in rows]
        }

    def get_stats_summary(self) -> Dict:
        """获取统计摘要"""
        conn = get_progress_connection()
        cursor = conn.cursor()

        today = datetime.now().strftime('%Y-%m-%d')
        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        month_ago = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')

        cursor.execute("SELECT COUNT(*) FROM pipeline_progress_history")
        total_tasks = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM pipeline_progress_history WHERE DATE(start_time) = ?", (today,))
        today_tasks = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM pipeline_progress_history WHERE start_time >= ?", (week_ago,))
        week_tasks = cursor.fetchone()[0]

        cursor.execute("""
            SELECT ROUND(CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS FLOAT) /
                   NULLIF(COUNT(*), 0) * 100, 2)
            FROM pipeline_progress_history
        """)
        success_rate = cursor.fetchone()[0] or 0

        cursor.execute("SELECT ROUND(AVG(duration_seconds), 1) FROM pipeline_progress_history WHERE duration_seconds > 0")
        avg_duration = cursor.fetchone()[0] or 0

        cursor.execute("SELECT SUM(processed_count) FROM pipeline_progress_history")
        total_records = cursor.fetchone()[0] or 0

        cursor.execute("SELECT COUNT(*) FROM pipeline_progress")
        active_tasks = cursor.fetchone()[0]

        cursor.execute("""
            SELECT task_type, COUNT(*) as count, AVG(duration_seconds) as avg_duration
            FROM pipeline_progress_history
            GROUP BY task_type
            ORDER BY count DESC
        """)
        task_type_rows = cursor.fetchall()

        conn.close()

        return {
            'total_tasks': total_tasks,
            'today_tasks': today_tasks,
            'week_tasks': week_tasks,
            'success_rate': success_rate,
            'avg_duration': avg_duration,
            'total_records': total_records,
            'active_tasks': active_tasks,
            'task_types': [{'type': row[0], 'count': row[1], 'avg_duration': round(row[2] or 0, 1)}
                          for row in task_type_rows]
        }

    def get_chart_data(self, days: int = 7) -> List[Dict]:
        """获取图表数据"""
        conn = get_progress_connection()
        cursor = conn.cursor()

        chart_data = []
        for i in range(days - 1, -1, -1):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')

            cursor.execute("""
                SELECT COUNT(*), COALESCE(SUM(processed_count), 0)
                FROM pipeline_progress_history
                WHERE DATE(start_time) = ?
            """, (date,))

            row = cursor.fetchone()
            chart_data.append({
                'date': date,
                'task_count': row[0] or 0,
                'records': row[1] or 0
            })

        conn.close()
        return chart_data

    def clear_old_history(self, days: int = 30):
        """清除旧历史记录"""
        conn = get_progress_connection()
        cursor = conn.cursor()

        before_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        cursor.execute("DELETE FROM pipeline_progress_history WHERE start_time < ?", (before_date,))

        deleted = cursor.rowcount
        conn.commit()
        conn.close()

        return deleted


_progress_db = ProgressDB()


def get_progress_db() -> ProgressDB:
    return _progress_db