#!/usr/bin/env python3
import json
import sys
from urllib.request import urlopen, Request


BASE = "http://127.0.0.1:8000/api/v2"


def request(path: str, method: str = "GET", payload=None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(BASE + path, data=data, headers=headers, method=method)
    with urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    exams = request("/exams")
    assert exams["code"] == "OK"
    if not exams["data"]:
        print("[skip] no exams data")
        return

    exam_id = exams["data"][0]["id"]
    exam_detail = request(f"/exams/{exam_id}")
    assert exam_detail["code"] == "OK"

    submit = request(
        "/answers/submit",
        method="POST",
        payload={"user_id": "guest", "exam_id": exam_id, "answers": {}},
    )
    assert submit["code"] == "OK"

    stats = request("/statistics/guest")
    assert stats["code"] == "OK"
    print("[ok] integration smoke passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[fail] {exc}")
        sys.exit(1)
