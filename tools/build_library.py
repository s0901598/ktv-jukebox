"""幫歌單裡每首歌找 YouTube 伴唱版,合併進 data/library.json。

用法: python3 tools/build_library.py tools/songs-batch1.txt
歌單格式: 一行一首「語言|歌手|歌名」,對唱歌的歌手用「、」分開(會自動標成對唱)。已經在歌庫裡的歌會跳過,不重複扣額度。
每首歌扣約 101 點 YouTube 額度(搜尋 100 + 查長度 1),每天 10,000 點。
"""
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "data" / "library.json"
KEY = re.search(r'youtubeApiKey = "([^"]+)"', (ROOT / "js" / "config.js").read_text()).group(1)
REFERER = "http://localhost:8765/"  # 金鑰限制只允許 GitHub 網址與這個本機網址

KARAOKE = re.compile(r"ktv|伴唱|卡拉|karaoke|導唱|导唱|伴奏|消音", re.I)
BAD = re.compile(r"cover|翻唱|教學|教唱|live|現場|演唱會|dj|remix|舞曲|一小時|循環|串燒|合輯|reaction", re.I)


def api(path, **params):
    params["key"] = KEY
    url = f"https://www.googleapis.com/youtube/v3/{path}?{urllib.parse.urlencode(params)}"
    out = subprocess.run(["curl", "-s", "-H", f"Referer: {REFERER}", url], capture_output=True, text=True).stdout
    data = json.loads(out)
    if "error" in data:
        reason = (data["error"].get("errors") or [{}])[0].get("reason", "")
        raise RuntimeError(f"{reason}: {data['error'].get('message')}")
    return data


def seconds(iso):
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    h, mi, s = (int(x or 0) for x in m.groups()) if m else (0, 0, 0)
    return h * 3600 + mi * 60 + s


def fmt(sec):
    return f"{sec // 60}:{sec % 60:02d}"


def unescape(s):
    import html
    return html.unescape(s)


SIMPLIFIED = str.maketrans("爱里干梦见别温伤说乐风听难过双恋泪后来长这时为们么飞凤邓丽叶陈张刘黄伦杰间顶欢喜宝贝灯红线乡愿乐无爱情幹拼誰妳", "愛裡乾夢見別溫傷說樂風聽難過雙戀淚後來長這時為們麼飛鳳鄧麗葉陳張劉黃倫傑間頂歡喜寶貝燈紅線鄉願樂無愛情干拚啥你")


def exact_song(song, flat):
    return song in flat or song.translate(SIMPLIFIED) in flat.translate(SIMPLIFIED)


def score(item, artist, song, rank):
    title = item["title"]
    flat = re.sub(r"\s+", "", title)
    sc = 0.0
    # 標題裡要有完整歌名(繁簡都算),只有零散的字對上不算
    if exact_song(song, flat):
        sc += 4
    else:
        sc -= 6
    if KARAOKE.search(title):
        sc += 3
    if any(a in flat for a in re.split(r"[、,&]", artist)):
        sc += 1
    if BAD.search(title):
        sc -= 2
    if not KARAOKE.search(title):
        sc -= 1
    if not 120 <= item["sec"] <= 480:
        sc -= 5
    return sc - rank * 0.15


def find(lang, artist, song):
    data = api("search", part="snippet", type="video", videoEmbeddable="true", videoSyndicated="true",
               maxResults=10, regionCode="TW", relevanceLanguage="zh-Hant", q=f"{artist} {song} KTV 伴唱")
    items = [{"videoId": it["id"]["videoId"], "title": unescape(it["snippet"]["title"]),
              "channel": unescape(it["snippet"]["channelTitle"])} for it in data.get("items", [])]
    if not items:
        return None
    detail = api("videos", part="contentDetails", id=",".join(i["videoId"] for i in items))
    durs = {v["id"]: seconds(v["contentDetails"]["duration"]) for v in detail.get("items", [])}
    for i in items:
        i["sec"] = durs.get(i["videoId"], 0)
    best = max(enumerate(items), key=lambda p: score(p[1], artist, song, p[0]))[1]
    if not exact_song(song, re.sub(r"\s+", "", best["title"])):
        return None  # 沒有標題含完整歌名的影片,寧可不收也不要收錯歌
    return {
        "lang": lang, "artist": artist, "song": song,
        "videoId": best["videoId"], "title": best["title"], "channel": best["channel"],
        "duration": fmt(best["sec"]), "karaoke": bool(KARAOKE.search(best["title"])),
        "duet": "、" in artist,
    }


def main(list_file):
    library = json.loads(LIBRARY.read_text()) if LIBRARY.exists() else []
    have = {(s["artist"], s["song"]) for s in library}
    added = []
    for line in Path(list_file).read_text().splitlines():
        if not line.strip():
            continue
        lang, artist, song = (x.strip() for x in line.split("|"))
        if (artist, song) in have:
            continue
        try:
            entry = find(lang, artist, song)
        except RuntimeError as e:
            print(f"停止:{e}(已處理的歌會先存起來)")
            break
        if entry:
            library.append(entry)
            have.add((artist, song))
            added.append(entry)
            print(f"✓ {artist} {song} → {entry['title']} ({entry['duration']})")
        else:
            print(f"✗ {artist} {song}:找不到")
    LIBRARY.parent.mkdir(exist_ok=True)
    LIBRARY.write_text(json.dumps(library, ensure_ascii=False, indent=1) + "\n")
    print(f"新增 {len(added)} 首,歌庫共 {len(library)} 首")


if __name__ == "__main__":
    main(sys.argv[1])
