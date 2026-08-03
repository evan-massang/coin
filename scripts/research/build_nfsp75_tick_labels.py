from __future__ import annotations

import argparse
import csv
import json
import lzma
import math
import struct
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

DUKAS_BASE = "https://datafeed.dukascopy.com/datafeed/XAUUSD"
POINT_SCALE = 1000.0
RECORD = struct.Struct(">3I2f")


@dataclass
class Tick:
    at: datetime
    ask: float
    bid: float

    @property
    def mid(self) -> float:
        return (self.ask + self.bid) / 2.0


def parse_release_timestamp(metadata: dict) -> datetime | None:
    consensus = metadata.get("consensus") or {}
    matched = consensus.get("matchedAt")
    if matched:
        return datetime.fromisoformat(matched.replace("Z", "+00:00")).astimezone(timezone.utc)
    return None


def load_nfp_events(path: Path, date_from: str, date_to: str) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    events = []
    lo = datetime.fromisoformat(date_from).date()
    hi = datetime.fromisoformat(date_to).date()
    for event in raw["events"]:
        metadata = event.get("metadata") or {}
        if metadata.get("seriesId") != "PAYEMS":
            continue
        consensus = metadata.get("consensus") or {}
        if consensus.get("forecast") is None:
            continue
        release = parse_release_timestamp(metadata)
        if release is None or not (lo <= release.date() <= hi):
            continue
        events.append(
            {
                "release": release,
                "observation_date": metadata.get("observationDate"),
                "actual": consensus.get("actual"),
                "forecast": consensus.get("forecast"),
                "previous": consensus.get("previous"),
                "previous_revised_from": consensus.get("previousRevisedFrom"),
                "occurrence_id": consensus.get("occurrenceId"),
            }
        )
    events.sort(key=lambda row: row["release"])
    return events


def dukas_url(hour: datetime) -> str:
    hour = hour.astimezone(timezone.utc)
    return (
        f"{DUKAS_BASE}/{hour.year}/{hour.month - 1:02d}/{hour.day:02d}/"
        f"{hour.hour:02d}h_ticks.bi5"
    )


def cache_name(hour: datetime) -> str:
    return f"dukas_{hour:%Y%m%d_%H}.bi5"


def download_hour(session: requests.Session, hour: datetime, cache_dir: Path) -> Path | None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / cache_name(hour)
    if path.exists() and path.stat().st_size > 0:
        return path
    url = dukas_url(hour)
    for attempt in range(4):
        try:
            response = session.get(url, timeout=30)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            if not response.content:
                return None
            path.write_bytes(response.content)
            return path
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1.5 * (attempt + 1))
    return None


def parse_bi5(path: Path, hour: datetime) -> list[Tick]:
    try:
        payload = lzma.decompress(path.read_bytes())
    except lzma.LZMAError:
        return []
    if len(payload) % RECORD.size:
        raise ValueError(f"Corrupt BI5 length for {path}: {len(payload)}")
    base = hour.replace(minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    ticks: list[Tick] = []
    for offset in range(0, len(payload), RECORD.size):
        ms, ask_raw, bid_raw, _ask_volume, _bid_volume = RECORD.unpack_from(payload, offset)
        ticks.append(
            Tick(
                at=base + timedelta(milliseconds=ms),
                ask=ask_raw / POINT_SCALE,
                bid=bid_raw / POINT_SCALE,
            )
        )
    return ticks


def classify(ticks: list[Tick], release: datetime, horizon_seconds: int, barrier_pct: float) -> dict:
    before = [tick for tick in ticks if tick.at < release]
    if not before:
        return {
            "label": "CLOSED",
            "reference": None,
            "reference_age_ms": None,
            "first_touch_ms": None,
            "max_up_pct": None,
            "max_down_pct": None,
            "tick_count": 0,
            "pre_spread_bps": None,
        }
    reference_tick = before[-1]
    reference = reference_tick.mid
    end = release + timedelta(seconds=horizon_seconds)
    after = [tick for tick in ticks if release <= tick.at <= end]
    if not after:
        return {
            "label": "CLOSED",
            "reference": reference,
            "reference_age_ms": (release - reference_tick.at).total_seconds() * 1000,
            "first_touch_ms": None,
            "max_up_pct": None,
            "max_down_pct": None,
            "tick_count": 0,
            "pre_spread_bps": ((reference_tick.ask - reference_tick.bid) / reference) * 10000,
        }
    upper = reference * (1 + barrier_pct / 100.0)
    lower = reference * (1 - barrier_pct / 100.0)
    label = "FLAT"
    first_touch_ms = None
    max_up = -math.inf
    max_down = math.inf
    for tick in after:
        mid = tick.mid
        pct = (mid / reference - 1) * 100
        max_up = max(max_up, pct)
        max_down = min(max_down, pct)
        if first_touch_ms is None:
            if mid >= upper:
                label = "UP"
                first_touch_ms = (tick.at - release).total_seconds() * 1000
            elif mid <= lower:
                label = "DOWN"
                first_touch_ms = (tick.at - release).total_seconds() * 1000
    return {
        "label": label,
        "reference": reference,
        "reference_age_ms": (release - reference_tick.at).total_seconds() * 1000,
        "first_touch_ms": first_touch_ms,
        "max_up_pct": max_up,
        "max_down_pct": max_down,
        "tick_count": len(after),
        "pre_spread_bps": ((reference_tick.ask - reference_tick.bid) / reference) * 10000,
    }


def process_event(session: requests.Session, event: dict, cache_dir: Path, barrier_pct: float) -> dict:
    release = event["release"]
    hours = [
        (release - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0),
        release.replace(minute=0, second=0, microsecond=0),
    ]
    ticks: list[Tick] = []
    downloaded = []
    for hour in hours:
        path = download_hour(session, hour, cache_dir)
        if path:
            downloaded.append(path.name)
            ticks.extend(parse_bi5(path, hour))
    ticks.sort(key=lambda tick: tick.at)
    outputs = {**event, "downloaded_files": ";".join(downloaded)}
    for seconds in (2, 10, 60, 300, 900):
        result = classify(ticks, release, seconds, barrier_pct)
        prefix = f"h{seconds}"
        for key, value in result.items():
            outputs[f"{prefix}_{key}"] = value
    outputs["release"] = release.isoformat()
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--macro-json", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--from-date", default="2008-03-01")
    parser.add_argument("--to-date", default="2019-12-31")
    parser.add_argument("--barrier-pct", type=float, default=0.10)
    args = parser.parse_args()

    events = load_nfp_events(args.macro_json, args.from_date, args.to_date)
    print(f"Loaded {len(events)} PAYEMS releases")
    session = requests.Session()
    session.headers.update({"User-Agent": "NFSP75 historical first-spike research"})
    rows = []
    for index, event in enumerate(events, start=1):
        print(f"[{index:03d}/{len(events):03d}] {event['release'].isoformat()}", flush=True)
        try:
            rows.append(process_event(session, event, args.cache_dir, args.barrier_pct))
        except Exception as exc:
            rows.append({**event, "release": event["release"].isoformat(), "error": repr(exc)})
            print(f"  ERROR: {exc}", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = sorted({key for row in rows for key in row})
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {args.out} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
