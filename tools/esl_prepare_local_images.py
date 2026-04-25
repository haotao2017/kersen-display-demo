#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
离线准备本地图片的 service0c payload（base64），不做任何下发。

用途：
- 先把 test.jpg / test_1.png 按当前推理规则编码成 replacementService0cB64
- 等需要上屏确认时，只需把生成的 b64 通过 replayOfficialDownlink 注入即可
"""

from __future__ import annotations

import argparse
from pathlib import Path

from esl_pack_service0c import main as pack_main


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture-id", default="cap_mocxl9z4_2qizoe")
    ap.add_argument("--out-dir", default="/tmp/esl_local_payloads")
    ap.add_argument("--thr", type=int, default=140)
    ap.add_argument("--white-code", type=int, default=2)
    ap.add_argument("--banded-delta", action="store_true", default=True)
    args, _ = ap.parse_known_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    repo = Path(__file__).resolve().parents[1]
    items = [
        ("test.jpg", repo / "test.jpg"),
        ("test_1.png", repo / "test_1.png"),
    ]

    for name, path in items:
        if not path.exists():
            continue
        out = out_dir / f"{name}.service0c.b64.txt"
        # 调用 pack 脚本入口（复用参数解析），只生成 b64 文件
        import sys

        sys.argv = [
            "esl_pack_service0c.py",
            "--capture-id",
            str(args.capture_id),
            "--image",
            str(path),
            "--thr",
            str(args.thr),
            "--white-code",
            str(args.white_code),
            "--out",
            str(out),
        ] + (["--banded-delta"] if args.banded_delta else [])
        pack_main()
        print(f"wrote {out}")


if __name__ == "__main__":
    main()

