#!/usr/bin/env python3
"""
Quick perf harness for local baseline.
Usage: python cpp-backend/tests/perf_read_score.py
"""

from __future__ import annotations

import json
import statistics
import time
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8000/api/v2"


def call(path: str, method: str = "GET", body=None):
    payload = None
    headers = {}
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(BASE + path, data=payload, headers=headers, method=method)
    t0 = time.perf_counter()
    with urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    dt_ms = (time.perf_counter() - t0) * 1000
    return dt_ms, data


def p95(values):
    if not values:
        return 0
    values = sorted(values)
    idx = int(len(values) * 0.95) - 1
    return values[max(0, idx)]


def main():
    read_lat = []
    score_lat = []

    _, exams = call("/exams")
    exam_id = exams["data"][0]["id"] if exams["data"] else None
    if not exam_id:
        print("no exams found, skip")
        return

    for _ in range(30):
        dt, _ = call(f"/exams/{exam_id}")
        read_lat.append(dt)

    for _ in range(30):
        dt, _ = call(
            "/answers/submit",
            method="POST",
            body={"user_id": "guest", "exam_id": exam_id, "answers": {}},
        )
        score_lat.append(dt)

    print(f"read mean={statistics.mean(read_lat):.2f}ms p95={p95(read_lat):.2f}ms")
    print(f"score mean={statistics.mean(score_lat):.2f}ms p95={p95(score_lat):.2f}ms")


if __name__ == "__main__":
    main()
