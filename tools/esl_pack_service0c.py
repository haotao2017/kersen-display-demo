#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
将本地图片编码成 READ_WRITE_SVC 的 service 01-00-00-0c（service0c）payload。

当前实现基于“基线 capture”的 service0c 解压结果做掩码注入：
- service0c 结构：4 字节头 + 多个 chunk（chunkId + compressedLen(LE16) + deflateRaw）
- 解压后 chunk 大多为 8192 字节（推测 256x128 的 2bpp 平面/索引图）
- 基线 chunk 中大量 0x55（2bpp=01）看起来像“透明/不变”填充值
- 注入策略：只在基线 chunk 的“非 0x55”位置写入目标图对应索引处的字节，其他保持基线不动

注意：该脚本用于离线生成 replacementService0cB64；实际渲染效果需以设备为准。
"""

from __future__ import annotations

import argparse
import base64
import json
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Tuple

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
STORE_JSON = REPO_ROOT / "apps" / "api" / "data" / "store.json"


SERVICE0C_MAGIC = bytes.fromhex("a5a60c02")
FILL = 0x55  # 2bpp: 01 01 01 01（推测为“透明/不改写”）


@dataclass
class Chunk:
    cid: int
    comp: bytes
    dec: bytes


def load_service0c_from_store(capture_id: str) -> bytes:
    store = json.loads(STORE_JSON.read_text(encoding="utf-8"))
    caps = store.get("officialDownlinkCaptures", [])
    cap = next((c for c in caps if c.get("id") == capture_id), None)
    if not cap or not cap.get("text"):
        raise SystemExit(f"找不到 captureId={capture_id} 或其 text 为空")
    parsed = json.loads(cap["text"])
    cmds = parsed.get("opas", [{}])[0].get("cmds", [])
    cmd = next((c for c in cmds if c.get("service") == "01-00-00-0c" and c.get("b64dat")), None)
    if not cmd:
        raise SystemExit(f"captureId={capture_id} 未包含 service 01-00-00-0c")
    raw = base64.b64decode(cmd["b64dat"])
    if not raw.startswith(SERVICE0C_MAGIC):
        raise SystemExit("service0c magic 不匹配，无法解析")
    return raw


def load_service0c_from_b64_file(path: Path) -> bytes:
    raw = base64.b64decode(path.read_text(encoding="utf-8").strip())
    if not raw.startswith(SERVICE0C_MAGIC):
        raise SystemExit(f"service0c magic 不匹配，无法解析：{path}")
    return raw


def parse_container(service0c: bytes) -> List[Chunk]:
    container = service0c[4:]
    p = 0
    chunks: List[Chunk] = []
    while p + 3 <= len(container):
        cid = container[p]
        clen = int.from_bytes(container[p + 1 : p + 3], "little")
        p += 3
        comp = container[p : p + clen]
        p += clen
        dec = zlib.decompress(comp, wbits=-zlib.MAX_WBITS)
        chunks.append(Chunk(cid=cid, comp=comp, dec=dec))
    if p != len(container):
        raise SystemExit("chunk 解析未对齐，container 结构异常")
    return chunks


def pack_image_2bpp_256x128(path: Path, *, thr: int = 140, white_code: int = 2) -> bytes:
    # 2bpp index 经验推断：
    # - 0: 黑（全 0x00 时屏幕全黑）
    # - 3: 红（全 0xFF 时屏幕全红）
    # - 1: “透明/不改写”（大量 0x55 出现在基线 payload）
    # - 2: 更像“显式白/浅色”（需要进一步离线/上屏验证）
    W, H = 256, 128
    img = Image.open(path).convert("L").resize((W, H))
    pix = img.load()
    vals = [white_code] * (W * H)
    for y in range(H):
        for x in range(W):
            vals[y * W + x] = 0 if pix[x, y] < thr else white_code

    out = bytearray(W * H // 4)  # 8192
    for i in range(0, len(vals), 4):
        # MSB-first packing: p0->bits7-6, p1->5-4, p2->3-2, p3->1-0
        out[i // 4] = ((vals[i] & 3) << 6) | ((vals[i + 1] & 3) << 4) | ((vals[i + 2] & 3) << 2) | (vals[i + 3] & 3)
    return bytes(out)


def pack_banded_delta_2bpp_chunks(
    path: Path,
    *,
    thr: int = 140,
    white_code: int = 2,
    transparent_code: int = 1,
) -> dict[int, bytes]:
    """
    生成按条带分片的 delta chunk（cid 1..11），每个 chunk 只覆盖自己的 y 范围。
    - 覆盖范围内：写入 0(黑) / white_code(白)
    - 覆盖范围外：写入 transparent_code（默认为 1，推测为“透明/不改写”）
    """
    W, H = 256, 128
    img = Image.open(path).convert("L").resize((W, H))
    pix = img.load()

    def get_code(x: int, y: int) -> int:
        return 0 if pix[x, y] < thr else white_code

    def write_pixel(buf: bytearray, x: int, y: int, code: int) -> None:
        idx = y * W + x
        bi = idx // 4
        sh = (3 - (idx % 4)) * 2
        buf[bi] = (buf[bi] & ~(0b11 << sh)) | ((code & 0b11) << sh)

    init = 0
    for _ in range(4):
        init = (init << 2) | (transparent_code & 0b11)

    chunks: dict[int, bytes] = {}
    for cid in range(1, 12):
        src_y0 = (cid - 1) * 12
        src_y1 = cid * 12
        if cid == 11:
            src_y0, src_y1 = 120, 128

        # 关键假设：每个 chunk 对应屏幕一个纵向条带；chunk 内只读取某个固定 y 起点的一段行。
        # 这里默认写入 chunk 内 y=0..bandH-1（可通过其它模式做偏移）。
        buf = bytearray([init]) * (W * H // 4)  # 8192
        band_h = src_y1 - src_y0
        for dy, y in enumerate(range(src_y0, src_y1)):
            for x in range(W):
                write_pixel(buf, x, dy, get_code(x, y))
        chunks[cid] = bytes(buf)

    return chunks


def pack_banded_delta_2bpp_chunks_with_row_offsets(
    path: Path,
    *,
    thr: int = 140,
    white_code: int = 2,
    transparent_code: int = 1,
    row_offsets: dict[int, int],
) -> dict[int, bytes]:
    """
    与 pack_banded_delta_2bpp_chunks 类似，但把条带写入 chunk 内的指定起始行 row_offsets[cid]。
    row_offsets 的来源通常是基线 chunk 的 first-nonfill 行（离线推断）。
    """
    W, H = 256, 128
    img = Image.open(path).convert("L").resize((W, H))
    pix = img.load()

    def get_code(x: int, y: int) -> int:
        return 0 if pix[x, y] < thr else white_code

    def write_pixel(buf: bytearray, x: int, y: int, code: int) -> None:
        idx = y * W + x
        bi = idx // 4
        sh = (3 - (idx % 4)) * 2
        buf[bi] = (buf[bi] & ~(0b11 << sh)) | ((code & 0b11) << sh)

    init = 0
    for _ in range(4):
        init = (init << 2) | (transparent_code & 0b11)

    chunks: dict[int, bytes] = {}
    for cid in range(1, 12):
        src_y0 = (cid - 1) * 12
        src_y1 = cid * 12
        if cid == 11:
            src_y0, src_y1 = 120, 128

        band_h = src_y1 - src_y0
        dst_y0 = int(row_offsets.get(cid, 0))
        dst_y1 = min(H, dst_y0 + band_h)
        actual_h = dst_y1 - dst_y0

        buf = bytearray([init]) * (W * H // 4)
        for dy in range(actual_h):
            y = src_y0 + dy
            for x in range(W):
                write_pixel(buf, x, dst_y0 + dy, get_code(x, y))

        chunks[cid] = bytes(buf)

    return chunks


def pack_banded_delta_2bpp_chunks_with_offsets(
    path: Path,
    *,
    thr: int = 140,
    white_code: int = 2,
    transparent_code: int = 1,
    row_offsets: dict[int, int],
    col_byte_offsets: dict[int, int],
) -> dict[int, bytes]:
    """
    与 pack_banded_delta_2bpp_chunks 类似，但把条带写入 chunk 内的指定起始行/列（按“字节列偏移”）。
    - row_offsets[cid]: chunk 内起始行（0..127）
    - col_byte_offsets[cid]: 每行起始字节偏移（0..63），每字节对应 4 个像素（2bpp）
    """
    W, H = 256, 128
    img = Image.open(path).convert("L").resize((W, H))
    pix = img.load()

    def get_code(x: int, y: int) -> int:
        return 0 if pix[x, y] < thr else white_code

    def write_pixel(buf: bytearray, x: int, y: int, code: int) -> None:
        if not (0 <= x < W and 0 <= y < H):
            return
        idx = y * W + x
        bi = idx // 4
        sh = (3 - (idx % 4)) * 2
        buf[bi] = (buf[bi] & ~(0b11 << sh)) | ((code & 0b11) << sh)

    init = 0
    for _ in range(4):
        init = (init << 2) | (transparent_code & 0b11)

    chunks: dict[int, bytes] = {}
    for cid in range(1, 12):
        src_y0 = (cid - 1) * 12
        src_y1 = cid * 12
        if cid == 11:
            src_y0, src_y1 = 120, 128

        band_h = src_y1 - src_y0
        dst_y0 = int(row_offsets.get(cid, 0))
        dst_y1 = min(H, dst_y0 + band_h)
        actual_h = dst_y1 - dst_y0

        dst_x0 = int(col_byte_offsets.get(cid, 0)) * 4

        buf = bytearray([init]) * (W * H // 4)
        for dy in range(actual_h):
            y = src_y0 + dy
            for x in range(W - dst_x0):
                write_pixel(buf, dst_x0 + x, dst_y0 + dy, get_code(x, y))

        chunks[cid] = bytes(buf)

    return chunks


def inject_by_baseline_mask(baseline: bytes, image_bytes: bytes) -> bytes:
    if len(baseline) != len(image_bytes):
        raise SystemExit("baseline/image 长度不一致，无法按 index 注入")
    out = bytearray(baseline)
    for i, b in enumerate(baseline):
        if b != FILL:
            out[i] = image_bytes[i]
    return bytes(out)


def inject_only_where_baseline_nonfill(baseline: bytes, overlay: bytes, *, fill_byte: int = FILL) -> bytes:
    """
    只在 baseline != fill_byte 的位置写入 overlay；其它保持 baseline。
    用于尽量保留模板底图，减少“横纹越来越多”的副作用。
    """
    if len(baseline) != len(overlay):
        raise SystemExit("baseline/overlay 长度不一致，无法注入")
    out = bytearray(baseline)
    for i, b in enumerate(baseline):
        if b != fill_byte:
            out[i] = overlay[i]
    return bytes(out)


def pack_banded_overlay_black_transparent_with_offsets(
    path: Path,
    *,
    thr: int = 140,
    transparent_code: int = 1,
    row_offsets: dict[int, int],
    col_byte_offsets: dict[int, int],
) -> dict[int, bytes]:
    """
    生成按条带分片的 overlay（cid 1..11），只使用 2bpp code：
    - 黑: 0
    - 透明: transparent_code（默认 1）
    用途：把本地图片作为“黑色叠加层”覆盖到基线模板上。
    """
    W, H = 256, 128
    img = Image.open(path).convert("L").resize((W, H))
    pix = img.load()

    def write_pixel(buf: bytearray, x: int, y: int, code: int) -> None:
        if not (0 <= x < W and 0 <= y < H):
            return
        idx = y * W + x
        bi = idx // 4
        sh = (3 - (idx % 4)) * 2
        buf[bi] = (buf[bi] & ~(0b11 << sh)) | ((code & 0b11) << sh)

    init = 0
    for _ in range(4):
        init = (init << 2) | (transparent_code & 0b11)

    chunks: dict[int, bytes] = {}
    for cid in range(1, 12):
        src_y0 = (cid - 1) * 12
        src_y1 = cid * 12
        if cid == 11:
            src_y0, src_y1 = 120, 128

        band_h = src_y1 - src_y0
        dst_y0 = int(row_offsets.get(cid, 0))
        dst_y1 = min(H, dst_y0 + band_h)
        actual_h = dst_y1 - dst_y0

        dst_x0 = int(col_byte_offsets.get(cid, 0)) * 4

        buf = bytearray([init]) * (W * H // 4)
        for dy in range(actual_h):
            y = src_y0 + dy
            for x in range(W - dst_x0):
                code = 0 if pix[x, y] < thr else transparent_code
                write_pixel(buf, dst_x0 + x, dst_y0 + dy, code)

        chunks[cid] = bytes(buf)

    return chunks


def pack_banded_overlay_windowed_from_baseline(
    baseline_chunks: dict[int, bytes],
    path: Path,
    *,
    thr: int = 140,
    transparent_code: int = 1,
    use_chunks: Iterable[int] = tuple(range(1, 12)),
) -> dict[int, bytes]:
    """
    基于基线 chunk 的“非 0x55 区域窗口”生成条带 overlay。

    思路：
    - 每个 chunk 对应屏幕一个纵向条带（高度约 12 行，最后一个 8 行）
    - 设备只读取 chunk 内某个行区间 + 某个列区间（从基线非 0x55 推断）
    - 只在该窗口内写入：黑(0)/透明(transparent_code)
    - 窗口外保持透明

    这个模式比单纯 offsets 更保守，避免把“无效区域”写成噪声导致横纹。
    """
    W, H = 256, 128
    img = Image.open(path).convert("L").resize((W, H))

    def pack_band_mask(y0: int, y1: int, out_w: int) -> Image.Image:
        # 取源条带，按 out_w 缩放到窗口宽
        band = img.crop((0, y0, W, y1)).resize((out_w, y1 - y0))
        return band

    def write_pixel(buf: bytearray, x: int, y: int, code: int) -> None:
        idx = y * W + x
        bi = idx // 4
        sh = (3 - (idx % 4)) * 2
        buf[bi] = (buf[bi] & ~(0b11 << sh)) | ((code & 0b11) << sh)

    init = 0
    for _ in range(4):
        init = (init << 2) | (transparent_code & 0b11)

    out: dict[int, bytes] = {}
    row_bytes = 64  # 256px @ 2bpp => 64 bytes per row

    for cid in use_chunks:
        baseline = baseline_chunks.get(cid)
        if not baseline or len(baseline) != 8192:
            continue

        # band source y-range
        src_y0 = (cid - 1) * 12
        src_y1 = cid * 12
        if cid == 11:
            src_y0, src_y1 = 120, 128
        band_h = src_y1 - src_y0

        # find dst row start from first nonfill
        first = next((i for i, b in enumerate(baseline) if b != FILL), 0)
        dst_row0 = first // row_bytes
        dst_row1 = min(128, dst_row0 + band_h)

        # within dst rows, find min/max col_byte that is nonfill
        cols: list[int] = []
        for r in range(dst_row0, dst_row1):
            row = baseline[r * row_bytes : (r + 1) * row_bytes]
            cols.extend([c for c, b in enumerate(row) if b != FILL])
        if not cols:
            continue
        col0 = min(cols)
        col1 = max(cols) + 1
        win_w_bytes = max(1, col1 - col0)
        win_w_px = min(W, win_w_bytes * 4)

        # build overlay buffer filled with transparent
        buf = bytearray([init]) * (W * H // 4)
        band_img = pack_band_mask(src_y0, src_y1, win_w_px)
        px = band_img.load()

        for dy in range(dst_row1 - dst_row0):
            for x in range(win_w_px):
                code = 0 if px[x, dy] < thr else transparent_code
                write_pixel(buf, col0 * 4 + x, dst_row0 + dy, code)

        out[cid] = bytes(buf)

    return out


def pack_image_codes(path: Path, size: tuple[int, int], *, thr: int = 140, white_code: int = 2) -> list[int]:
    img = Image.open(path).convert("L").resize(size)
    pix = img.load()
    w, h = size
    return [0 if pix[x, y] < thr else white_code for y in range(h) for x in range(w)]


def pack_codes_2bpp(codes: list[int], *, width: int, height: int) -> bytes:
    if len(codes) != width * height:
        raise SystemExit("2bpp codes 长度与宽高不匹配")
    out = bytearray((width * height) // 4)
    for i in range(0, len(codes), 4):
        out[i // 4] = ((codes[i] & 3) << 6) | ((codes[i + 1] & 3) << 4) | ((codes[i + 2] & 3) << 2) | (codes[i + 3] & 3)
    return bytes(out)


def changed_byte_window(base: bytes, ref: bytes, *, row_bytes: int) -> tuple[int, int, int, int, set[int]] | None:
    changed = {i for i in range(min(len(base), len(ref))) if base[i] != ref[i]}
    if not changed:
        return None
    rows = [i // row_bytes for i in changed]
    cols = [i % row_bytes for i in changed]
    return min(cols), min(rows), max(cols) + 1, max(rows) + 1, changed


def pack_official_diff_windows(
    base_chunks: dict[int, bytes],
    reference_chunks: dict[int, bytes],
    path: Path,
    *,
    thr: int = 140,
    white_code: int = 2,
) -> dict[int, bytes]:
    """
    使用“官方参考包 vs 基线包”的真实变动字节窗口写入本地图片。

    这是当前最保守的 service0c 注入方式：
    - 只处理官方实际变化过的 chunk（例如 4517 为 1/2/12）。
    - 只改这些 chunk 内官方实际变化过的 byte，不碰其它模板区域。
    - 将本地图片缩放到每个变化窗口，再按 2bpp 写入对应 byte。
    """
    out: dict[int, bytes] = {}
    for cid, ref in reference_chunks.items():
        base = base_chunks.get(cid)
        if not base or len(base) != len(ref):
            continue
        if len(ref) == 8192:
            width, height, row_bytes = 256, 128, 64
        elif len(ref) == 5888:
            width, height, row_bytes = 368, 64, 92
        else:
            continue

        window = changed_byte_window(base, ref, row_bytes=row_bytes)
        if not window:
            continue
        col0, row0, col1, row1, changed = window
        win_w = (col1 - col0) * 4
        win_h = row1 - row0
        if win_w <= 0 or win_h <= 0:
            continue

        # 将整张图缩放进官方实际变化窗口。窗口之间会重复同一图像，
        # 目的是先验证真实写入通道，再进一步拆成精确页面坐标。
        img_codes = pack_image_codes(path, (win_w, win_h), thr=thr, white_code=white_code)
        packed_window = pack_codes_2bpp(img_codes, width=win_w, height=win_h)
        next_dec = bytearray(ref)
        for y in range(win_h):
            src_row_start = y * (win_w // 4)
            dst_row_start = (row0 + y) * row_bytes + col0
            for bx in range(win_w // 4):
                dst = dst_row_start + bx
                if dst in changed:
                    next_dec[dst] = packed_window[src_row_start + bx]
        out[cid] = bytes(next_dec)
    return out


def active_pixel_bbox(dec: bytes, *, width: int, height: int) -> tuple[int, int, int, int, set[int]] | None:
    active_pixels: list[tuple[int, int]] = []
    active_bytes: set[int] = set()
    for i, b in enumerate(dec):
        if b == FILL:
            continue
        active_bytes.add(i)
        for k in range(4):
            pix = i * 4 + k
            x = pix % width
            y = pix // width
            if 0 <= x < width and 0 <= y < height:
                active_pixels.append((x, y))
    if not active_pixels:
        return None
    xs = [x for x, _ in active_pixels]
    ys = [y for _, y in active_pixels]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1, active_bytes


def pack_active_bbox_windows(
    base_chunks: dict[int, bytes],
    path: Path,
    *,
    thr: int = 140,
    white_code: int = 2,
    red_code: int = 3,
    use_red: bool = False,
    byte_fill: bool = False,
    use_chunks: Iterable[int] = tuple(range(1, 13)),
) -> dict[int, bytes]:
    """
    把本地图片缩放进每个 chunk 的 baseline active bbox，并只改 baseline 非 0x55 字节。

    这个模式建立在上屏已验证的事实上：baseline 非 0x55 区域置黑会产生可见变化。
    因此它不再依赖官方“文字 diff 窗口”，而是直接使用每个 chunk 的可见活跃区域。
    """
    out: dict[int, bytes] = {}
    for cid in use_chunks:
        base = base_chunks.get(cid)
        if not base:
            continue
        if len(base) == 8192:
            width, height = 256, 128
        elif len(base) == 5888:
            width, height = 368, 64
        else:
            continue

        bbox = active_pixel_bbox(base, width=width, height=height)
        if not bbox:
            continue
        x0, y0, x1, y1, active_bytes = bbox
        win_w = x1 - x0
        win_h = y1 - y0
        next_dec = bytearray(base)
        if byte_fill:
            byte_w = max(1, win_w // 4)
            codes = pack_image_codes(path, (byte_w, win_h), thr=thr, white_code=white_code)
            red_byte = 0
            black_byte = 0
            white_byte = 0
            for _ in range(4):
                red_byte = (red_byte << 2) | (red_code & 3)
                black_byte = (black_byte << 2)
                white_byte = (white_byte << 2) | (white_code & 3)
            for y in range(win_h):
                for bx in range(byte_w):
                    dst_byte = (y0 + y) * (width // 4) + (x0 // 4) + bx
                    if dst_byte not in active_bytes:
                        continue
                    code = codes[y * byte_w + bx]
                    next_dec[dst_byte] = red_byte if use_red and code == 0 else black_byte if code == 0 else white_byte
        else:
            codes = pack_image_codes(path, (win_w, win_h), thr=thr, white_code=white_code)
            if use_red:
                codes = [red_code if code == 0 else white_code for code in codes]
            for y in range(win_h):
                for x in range(win_w):
                    dst_pix = (y0 + y) * width + (x0 + x)
                    dst_byte = dst_pix // 4
                    if dst_byte not in active_bytes:
                        continue
                    shift = (3 - (dst_pix % 4)) * 2
                    code = codes[y * win_w + x] & 3
                    next_dec[dst_byte] = (next_dec[dst_byte] & ~(0b11 << shift)) | (code << shift)
        out[cid] = bytes(next_dec)
    return out

def rebuild_service0c(chunks: Iterable[Chunk]) -> bytes:
    reb = bytearray()
    for ch in chunks:
        co = zlib.compressobj(level=9, wbits=-zlib.MAX_WBITS)
        comp = co.compress(ch.dec) + co.flush()
        reb.append(ch.cid)
        reb += len(comp).to_bytes(2, "little")
        reb += comp
    return SERVICE0C_MAGIC + bytes(reb)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture-id", help="用于取 service0c 基线的 captureId（apps/api/data/store.json 内）")
    ap.add_argument("--service0c-b64", default="", help="直接从 base64 文件读取 service0c，优先于 --capture-id")
    ap.add_argument("--reference-service0c-b64", default="", help="官方参考 service0c base64 文件，用于 --official-diff-windows")
    ap.add_argument("--image", required=True, help="本地图片路径（jpg/png）")
    ap.add_argument("--thr", type=int, default=140, help="灰度阈值（<thr=黑，否则白）")
    ap.add_argument("--white-code", type=int, default=2, help="白色像素使用的 2bpp code（默认 2；1 通常视为透明/不改写）")
    ap.add_argument(
        "--banded-delta",
        action="store_true",
        help="将图片按条带写入 chunk1..11（覆盖各自 y 范围），其余位置用透明 code(1) 填充；不会参考基线 mask",
    )
    ap.add_argument(
        "--banded-delta-rowoffsets",
        action="store_true",
        help="banded-delta 的变体：条带写入 chunk 内的“推断起始行”（基线 first-nonfill 行），用于更贴近设备读取窗口",
    )
    ap.add_argument(
        "--banded-delta-offsets",
        action="store_true",
        help="banded-delta 的更强变体：条带写入 chunk 内的“推断起始行 + 起始字节列”（基线 first-nonfill 的行/列）",
    )
    ap.add_argument(
        "--overlay-black",
        action="store_true",
        help="生成“黑色叠加层”：按 offsets 写入条带（黑/透明），并且只在基线非 0x55 区域注入",
    )
    ap.add_argument(
        "--overlay-black-windowed",
        action="store_true",
        help="生成“黑色叠加层（windowed）”：按基线非 0x55 窗口推断每个 chunk 的有效窗口，再写入黑/透明条带，并仅注入基线非 0x55 区域",
    )
    ap.add_argument(
        "--official-diff-windows",
        action="store_true",
        help="按“官方参考 service0c vs 基线 service0c”的真实变动窗口写入图片，只改官方实际变化过的字节",
    )
    ap.add_argument(
        "--active-bbox-windows",
        action="store_true",
        help="把图片缩放进每个 chunk 的 baseline 非 0x55 活跃区域 bbox，并只修改活跃字节",
    )
    ap.add_argument(
        "--active-bbox-red",
        action="store_true",
        help="配合 --active-bbox-windows 使用：将黑色像素改为红色 code(3)，增强肉眼可见性",
    )
    ap.add_argument(
        "--active-bbox-bytefill",
        action="store_true",
        help="配合 --active-bbox-windows 使用：按 active byte 整字节强填充，增强条纹密度和可见性",
    )
    ap.add_argument("--out", default="", help="输出文件路径（写入 base64，不填则 stdout）")
    args = ap.parse_args()

    img_path = Path(args.image).expanduser().resolve()
    if not img_path.exists():
        raise SystemExit(f"图片不存在：{img_path}")

    if args.service0c_b64:
        service0c = load_service0c_from_b64_file(Path(args.service0c_b64).expanduser().resolve())
    elif args.capture_id:
        service0c = load_service0c_from_store(str(args.capture_id))
    else:
        raise SystemExit("必须提供 --capture-id 或 --service0c-b64")
    chunks = parse_container(service0c)

    thr = int(args.thr)
    white_code = int(args.white_code)

    if args.active_bbox_windows:
        base_map = {ch.cid: ch.dec for ch in chunks}
        windowed = pack_active_bbox_windows(
            base_map,
            img_path,
            thr=thr,
            white_code=white_code,
            use_red=bool(args.active_bbox_red),
            byte_fill=bool(args.active_bbox_bytefill),
        )
        next_chunks = []
        for ch in chunks:
            if ch.cid in windowed:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=windowed[ch.cid]))
            else:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=ch.dec))

    elif args.official_diff_windows:
        if not args.reference_service0c_b64:
            raise SystemExit("--official-diff-windows 需要 --reference-service0c-b64")
        reference = load_service0c_from_b64_file(Path(args.reference_service0c_b64).expanduser().resolve())
        reference_chunks = parse_container(reference)
        base_map = {ch.cid: ch.dec for ch in chunks}
        reference_map = {ch.cid: ch.dec for ch in reference_chunks}
        windowed = pack_official_diff_windows(
            base_map,
            reference_map,
            img_path,
            thr=thr,
            white_code=white_code,
        )
        next_chunks = []
        for ch in reference_chunks:
            if ch.cid in windowed:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=windowed[ch.cid]))
            else:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=ch.dec))

    elif args.overlay_black_windowed:
        baseline_map = {ch.cid: ch.dec for ch in chunks}
        overlays = pack_banded_overlay_windowed_from_baseline(
            baseline_map,
            img_path,
            thr=thr,
        )
        next_chunks: List[Chunk] = []
        for ch in chunks:
            if len(ch.dec) == 8192 and ch.cid in overlays:
                dec = inject_only_where_baseline_nonfill(ch.dec, overlays[ch.cid])
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=dec))
            else:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=ch.dec))

    elif args.overlay_black:
        row_offsets: dict[int, int] = {}
        col_offsets: dict[int, int] = {}
        for ch in chunks:
            if not (1 <= ch.cid <= 11 and len(ch.dec) == 8192):
                continue
            idx = next((i for i, b in enumerate(ch.dec) if b != FILL), None)
            if idx is None:
                row_offsets[ch.cid] = 0
                col_offsets[ch.cid] = 0
                continue
            row_offsets[ch.cid] = idx // 64
            col_offsets[ch.cid] = idx % 64

        overlays = pack_banded_overlay_black_transparent_with_offsets(
            img_path,
            thr=thr,
            row_offsets=row_offsets,
            col_byte_offsets=col_offsets,
        )

        next_chunks: List[Chunk] = []
        for ch in chunks:
            if len(ch.dec) == 8192 and ch.cid in overlays:
                dec = inject_only_where_baseline_nonfill(ch.dec, overlays[ch.cid])
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=dec))
            else:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=ch.dec))

    elif args.banded_delta_offsets:
        row_offsets: dict[int, int] = {}
        col_offsets: dict[int, int] = {}
        for ch in chunks:
            if not (1 <= ch.cid <= 11 and len(ch.dec) == 8192):
                continue
            idx = next((i for i, b in enumerate(ch.dec) if b != FILL), None)
            if idx is None:
                row_offsets[ch.cid] = 0
                col_offsets[ch.cid] = 0
                continue
            row_offsets[ch.cid] = idx // 64
            col_offsets[ch.cid] = idx % 64
        banded = pack_banded_delta_2bpp_chunks_with_offsets(
            img_path,
            thr=thr,
            white_code=white_code,
            row_offsets=row_offsets,
            col_byte_offsets=col_offsets,
        )
        next_chunks: List[Chunk] = []
        for ch in chunks:
            if len(ch.dec) == 8192 and ch.cid in banded:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=banded[ch.cid]))
            else:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=ch.dec))
    elif args.banded_delta_rowoffsets:
        # 基线 row offset 推断：读取基线 chunk 每 64 字节一行，找到第一个非 0x55 字节所在行
        row_offsets: dict[int, int] = {}
        for ch in chunks:
            if not (1 <= ch.cid <= 11 and len(ch.dec) == 8192):
                continue
            idx = next((i for i, b in enumerate(ch.dec) if b != FILL), None)
            row_offsets[ch.cid] = (idx // 64) if idx is not None else 0
        banded = pack_banded_delta_2bpp_chunks_with_row_offsets(
            img_path,
            thr=thr,
            white_code=white_code,
            row_offsets=row_offsets,
        )
        next_chunks: List[Chunk] = []
        for ch in chunks:
            if len(ch.dec) == 8192 and ch.cid in banded:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=banded[ch.cid]))
            else:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=ch.dec))
    elif args.banded_delta:
        banded = pack_banded_delta_2bpp_chunks(img_path, thr=thr, white_code=white_code)
        next_chunks: List[Chunk] = []
        for ch in chunks:
            if len(ch.dec) == 8192 and ch.cid in banded:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=banded[ch.cid]))
            else:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=ch.dec))
    else:
        img8192 = pack_image_2bpp_256x128(img_path, thr=thr, white_code=white_code)
        next_chunks = []
        for ch in chunks:
            if len(ch.dec) == 8192 and 1 <= ch.cid <= 11:
                dec = inject_by_baseline_mask(ch.dec, img8192)
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=dec))
            else:
                next_chunks.append(Chunk(cid=ch.cid, comp=b"", dec=ch.dec))

    rebuilt = rebuild_service0c(next_chunks)
    b64 = base64.b64encode(rebuilt).decode("ascii")

    if args.out:
        Path(args.out).write_text(b64, encoding="utf-8")
    else:
        print(b64)


if __name__ == "__main__":
    main()

