"""用指定的 YouTube 連結新增或取代歌庫裡的一首歌(只扣 1 點額度,不用搜尋)。

用法: python3 tools/add_link.py "台語|伍佰、萬芳|愛情限時批" https://youtu.be/xBHWe3eKoYE
同歌名同歌手已存在就換成新連結,不存在就新增。
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_library import GROUPS, KARAOKE, LIBRARY, api, fmt, seconds  # noqa: E402


def video_id(url):
    m = re.search(r"(?:youtu\.be/|v=|/shorts/|/embed/|/live/)([\w-]{11})", url)
    if m:
        return m.group(1)
    if re.fullmatch(r"[\w-]{11}", url):
        return url
    raise SystemExit(f"看不懂這個連結:{url}")


def main(spec, url):
    lang, artist, song = (x.strip() for x in spec.split("|"))
    vid = video_id(url)
    items = api("videos", part="snippet,contentDetails", id=vid).get("items", [])
    if not items:
        raise SystemExit(f"找不到影片 {vid}(可能已刪除或設為私人)")
    title = items[0]["snippet"]["title"]
    entry = {
        "lang": lang, "artist": artist, "song": song,
        "videoId": vid, "title": title, "channel": items[0]["snippet"]["channelTitle"],
        "duration": fmt(seconds(items[0]["contentDetails"]["duration"])),
        "karaoke": bool(KARAOKE.search(title)),
        "duet": "、" in artist,
        "group": artist in GROUPS,
    }
    library = json.loads(LIBRARY.read_text())
    for i, s in enumerate(library):
        if s["artist"] == artist and s["song"] == song:
            library[i] = entry
            print(f"已取代:{artist} {song} → {title}")
            break
    else:
        library.append(entry)
        print(f"已新增:{artist} {song} → {title}")
    LIBRARY.write_text(json.dumps(library, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
