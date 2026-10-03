"""Rebuild the 2018 EJU listening-reading clips from the original exam audio.

The old alignment-based clips included the exam introduction and, in one
case, only seven seconds of a question. Each pair below is the verified long
pause after a question, measured in the corresponding full-session recording.
"""

import hashlib
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "downloads" / "EJU日本语" / "【2】日本语听力音频+听力原文" / "听力音频2002-2023"
CONFIG = {
    "2018_01": {
        "source": SOURCE_ROOT / "2018平成30年第一回" / "平成30年第1回.mp3",
        "sha256": "7e49a41dfb56b74fd0f934b4f0a93e45afc176abe6acc3f5778f0a55ac7d0396",
        "pauses": [
            (335.01, 343.08), (415.34, 423.42), (520.14, 528.21),
            (598.32, 606.33), (708.82, 716.88), (817.07, 825.17),
            (906.58, 914.66), (1011.61, 1019.59), (1128.38, 1136.47),
            (1203.45, 1211.53), (1321.17, 1329.25), (1428.98, 1437.05),
        ],
    },
    "2018_02": {
        "source": SOURCE_ROOT / "2018平成30年第二回" / "平成30年第2回.mp3",
        "sha256": "8a2ea4e4e08efa7195594944e367c8cc2470b150fa654952d1bd4a7a263eb554",
        "pauses": [
            (317.63, 325.72), (399.31, 407.37), (504.16, 512.26),
            (611.07, 619.12), (707.95, 716.06), (823.73, 831.81),
            (916.50, 924.58), (1014.53, 1022.59), (1114.00, 1122.08),
            (1224.81, 1232.90), (1323.93, 1332.01), (1422.54, 1430.61),
        ],
    },
}


def rebuild(exam_id: str, config: dict) -> None:
    source = config["source"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != config["sha256"]:
        raise ValueError(f"Unexpected source recording for {exam_id}: {source}")
    pauses = config["pauses"]
    if len(pauses) != 12:
        raise ValueError(f"Expected 12 question boundaries for {exam_id}")
    destination = ROOT / "data" / "audio" / "eju" / exam_id
    start = 270.80  # The announcer begins question 1 at about 272 seconds.
    for number, (end, next_start) in enumerate(pauses, 1):
        if not 30 < end - start < 150 or not 7 < next_start - end < 10:
            raise ValueError(f"Unexpected question/pause duration for {exam_id} Q{number}")
        target = destination / f"track_{number + 5:02d}.mp3"
        temporary = target.with_name(target.stem + ".repair.mp3")
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-ss", f"{start:.2f}",
                 "-t", f"{end - start:.2f}", "-i", str(source), "-codec:a", "libmp3lame",
                 "-q:a", "4", str(temporary)],
                check=True,
            )
            if temporary.stat().st_size < 10000:
                raise ValueError(f"Encoded clip is too small: {temporary}")
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        start = next_start
    print(f"{exam_id}: rebuilt 12 listening-reading clips")


if __name__ == "__main__":
    for exam_id, config in CONFIG.items():
        rebuild(exam_id, config)
