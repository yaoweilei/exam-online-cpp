#!/usr/bin/env python3
"""
Normalize data/user/users.json and data/user/roles.json for C++ v2 backend.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Dict, Any


def sha256_hex(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalize_roles(raw: Dict[str, Any]) -> Dict[str, Any]:
    if "roles" in raw and isinstance(raw["roles"], list):
        normalized: Dict[str, Any] = {}
        for role in raw["roles"]:
            role_id = role.get("id")
            if not role_id:
                continue
            perms = role.get("permissions") or role.get("privileges") or []
            normalized[role_id] = {
                "id": role_id,
                "name": role.get("name", role_id),
                "description": role.get("description", ""),
                "permissions": perms,
            }
        return normalized
    return raw


def normalize_users(raw: Dict[str, Any]) -> Dict[str, Any]:
    users: Dict[str, Any] = {}
    for username, payload in raw.items():
        if not isinstance(payload, dict):
            continue
        users[username] = {
            "id": payload.get("id", username),
            "username": payload.get("username", username),
            "password_hash": payload.get("password_hash")
            or payload.get("password")
            or sha256_hex(username),
            "password_algo": payload.get("password_algo", "sha256"),
            "email": payload.get("email", ""),
            "roles": payload.get("roles", payload.get("roleIds", ["user"])),
            "created_at": payload.get("created_at", ""),
        }
    if "guest" not in users:
        users["guest"] = {
            "id": "guest",
            "username": "guest",
            "password_hash": sha256_hex("guest"),
            "password_algo": "sha256",
            "email": "",
            "roles": ["guest"],
            "created_at": "",
        }
    return users


def load_json(path: Path, default: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-dir", default=".", help="project root")
    args = parser.parse_args()

    base = Path(args.base_dir).resolve()
    user_dir = base / "data" / "user"
    roles_path = user_dir / "roles.json"
    users_path = user_dir / "users.json"

    roles = normalize_roles(load_json(roles_path, {}))
    users = normalize_users(load_json(users_path, {}))

    write_json(roles_path, roles)
    write_json(users_path, users)
    print(f"[ok] normalized roles: {roles_path}")
    print(f"[ok] normalized users: {users_path}")


if __name__ == "__main__":
    main()
