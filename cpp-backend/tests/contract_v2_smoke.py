#!/usr/bin/env python3
import json
import sys
from urllib.request import urlopen, Request


BASE = "http://127.0.0.1:8000/api/v2"


def get(path: str):
    req = Request(BASE + path, method="GET")
    with urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def assert_envelope(payload):
    for k in ("code", "message", "data", "request_id", "ts"):
        assert k in payload, f"missing key: {k}"


def main():
    exams = get("/exams")
    assert_envelope(exams)
    assert exams["code"] == "OK"
    assert isinstance(exams["data"], list)

    roles = get("/roles")
    assert_envelope(roles)
    assert roles["code"] == "OK"
    assert isinstance(roles["data"], dict)
    print("[ok] contract smoke passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[fail] {exc}")
        sys.exit(1)
