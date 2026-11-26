"""会話マップ: リアルタイムの会話を「話題の地図」として表示するローカルサーバー。

  python app.py            マイク入力（Apple Silicon Mac）
  python app.py --demo     サンプル会話を再生（マイク不要）
  python app.py --no-mic   画面のテキスト入力だけで使う
"""
from __future__ import annotations

import faulthandler

faulthandler.enable()  # 異常終了したとき、どこで落ちたかを表示する

import argparse
import asyncio
import json
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
CLAUDE_MODEL = os.environ.get("KAIWA_MODEL", "claude-haiku-5-5")
INSIGHT_INTERVAL = float(os.environ.get("KAIWA_INSIGHT_INTERVAL", "10"))
MIN_SUBSTANTIVE = 8  # これより短い発言（相槌など）は話題の判定に使わない


# ---------- 埋め込み（発言 → ベクトル） ----------

class Embedder:
    """fastembed の多言語モデルを使う。読み込めないときは文字ベースの簡易版に落とす。"""

    def __init__(self, kind: str):
        self.model = None
        self.name = "簡易（文字ベース）"
        self.join_th = 0.16
        if kind == "hash":
            return
        try:
            from fastembed import TextEmbedding

            self.model = TextEmbedding(EMBED_MODEL)
            self.name = "multilingual-MiniLM"
            self.join_th = 0.45
        except Exception as e:  # モデル未取得・オフライン初回など
            print(f"[embed] モデルを読み込めないため簡易版を使います: {e}")

    def __call__(self, text: str) -> np.ndarray:
        if self.model is not None:
            v = np.asarray(next(iter(self.model.embed([text]))), dtype=np.float32)
        else:
            v = self._hash(text)
        n = float(np.linalg.norm(v))
        return v / n if n else v

    @staticmethod
    def _hash(text: str, dim: int = 1024) -> np.ndarray:
        import zlib

        core = re.sub(r"[぀-ゟ\s、。！？!?,.「」・ー]", "", text)  # ひらがな・記号を除く
        v = np.zeros(dim, dtype=np.float32)
        grams = list(core) + [core[i : i + 2] for i in range(len(core) - 1)]
        for g in grams:
            v[zlib.crc32(g.encode()) % dim] += 2.0 if len(g) == 2 else 1.0
        return v


# ---------- 出てきたワードの抜き出し ----------

WORD_RE = re.compile(r"[一-龥々ヶ]{2,8}|[ァ-ヴー]{3,}|[A-Za-z][A-Za-z0-9]+")
STOP = set("今日 明日 昨日 今年 去年 来年 今回 次回 前回 最初 最後 必要 場合 感じ 自分 本当 大丈夫 以上 以下 一つ 二つ "
           "意味 一番 全部 一緒 最近 結構 多分 普通 問題 部分 以外 時間 可能 現実的 効率的 今年度".split())


def extract_words(text: str) -> list[str]:
    """漢字・カタカナ・英字のまとまりを語として拾う（形態素解析なしの簡易版）。"""
    return list(dict.fromkeys(w for w in WORD_RE.findall(text) if w not in STOP))


# ---------- 会話の状態 ----------

class Board:
    def __init__(self, embed: Embedder, join_th: float | None = None):
        self.embed = embed
        self.join_th = join_th or embed.join_th
        self.reset()
        self.current_speaker = "話者1"
        self.status = {"embedder": embed.name, "claude": "未接続", "source": ""}

    def reset(self):
        self.utts: list[dict] = []
        self.topics: list[dict] = []
        self.vecs: list[np.ndarray] = []
        self.stances: dict[str, str] = {}
        self.extra_speakers: list[str] = []
        self.now = ""
        self.direction = ""
        self.phase = ""
        self.decided: list[str] = []
        self.open: list[str] = []
        self.current_topic: int | None = None

    def add(self, speaker: str, text: str) -> dict:
        vec = self.embed(text)
        substantive = len(text) >= MIN_SUBSTANTIVE
        topic = self._pick_topic(vec, substantive)
        if topic is None:
            topic = {"id": len(self.topics), "label": "", "summary": "", "sum": np.zeros_like(vec),
                     "centroid": vec, "utts": [], "fallback": text[:14]}
            self.topics.append(topic)
        if substantive:
            topic["sum"] = topic["sum"] + vec
            n = float(np.linalg.norm(topic["sum"]))
            topic["centroid"] = topic["sum"] / n if n else vec
        utt = {"id": len(self.utts), "t": time.time(), "speaker": speaker, "text": text, "topic": topic["id"],
               "words": extract_words(text)}
        topic["utts"].append(utt["id"])
        self.utts.append(utt)
        self.vecs.append(vec)
        self.current_topic = topic["id"]
        return utt

    def _pick_topic(self, vec, substantive):
        if not self.topics:
            return None
        cur = self.topics[self.current_topic] if self.current_topic is not None else None
        if not substantive and cur is not None:
            return cur  # 相槌は直前の話題にぶら下げる
        sims = np.array([float(t["centroid"] @ vec) for t in self.topics])
        if cur is not None:
            sims[cur["id"]] += 0.05  # 話の流れは続きやすいので少しひいきする
        best = int(sims.argmax())
        return self.topics[best] if sims[best] >= self.join_th else None

    def motion(self) -> str:
        """直近10発言の動き方（Claude なしでも出せる、議論の向きの目安）。"""
        recent = self.utts[-10:]
        if len(self.utts) < 4:
            return ""
        new = sum(1 for t in self.topics if t["utts"][0] >= recent[0]["id"])
        switches = sum(1 for a, b in zip(recent, recent[1:]) if a["topic"] != b["topic"])
        if new >= 2:
            return "広がっている"
        return "行き来している" if switches >= 4 else "深まっている"

    def snapshot(self) -> dict:
        names = list(dict.fromkeys([u["speaker"] for u in self.utts] + self.extra_speakers + [self.current_speaker]))
        counts = {n: 0 for n in names}
        topics = []
        tf: list[dict[str, int]] = []  # 話題ごとの語の出現数
        for t in self.topics:
            c: dict[str, int] = {}
            for uid in t["utts"]:
                for w in self.utts[uid]["words"]:
                    c[w] = c.get(w, 0) + 1
            tf.append(c)
        for t in self.topics:
            shares: dict[str, int] = {}
            for uid in t["utts"]:
                sp = self.utts[uid]["speaker"]
                shares[sp] = shares.get(sp, 0) + 1
                counts[sp] += 1
            # その話題でよく出て、ほかの話題にはあまり出ない語を上位に
            score = lambda w, n: n * (1 + np.log(len(tf) / sum(1 for c in tf if w in c)))
            words = sorted(tf[t["id"]].items(), key=lambda kv: -score(*kv))[:5]
            topics.append({"id": t["id"], "label": t["label"] or t["fallback"], "labeled": bool(t["label"]),
                           "summary": t["summary"], "count": len(t["utts"]), "shares": shares, "words": words})
        links = []
        for i, a in enumerate(self.topics):
            for b in self.topics[i + 1 :]:
                sim = float(a["centroid"] @ b["centroid"])
                if sim >= self.join_th * 0.6:
                    links.append({"a": a["id"], "b": b["id"], "sim": round(sim, 3)})
        return {
            "speakers": [{"name": n, "count": counts[n], "stance": self.stances.get(n, "")} for n in names],
            "current_speaker": self.current_speaker,
            "topics": topics,
            "utts": self.utts,
            "links": links,
            "current_topic": self.current_topic,
            "now": self.now,
            "direction": self.direction,
            "phase": self.phase or self.motion(),
            "decided": self.decided,
            "open": self.open,
            "status": self.status,
        }


# ---------- Claude による意味づけ（話題名・要約・各人のスタンス） ----------

INSIGHT_SYSTEM = """あなたは進行中の会議をリアルタイムで整理するアシスタントです。
発言は音声認識の結果なので、誤変換や言い淀みを含みます。文脈から補って読んでください。
発言は意味の近さで自動的に「話題」へ振り分け済みです。各話題について次を日本語で返してください。

- label: その話題を表す短い名前（12文字以内、体言止め）。発言が少なく判断できない場合も、最もありそうな名前を付ける。
- summary: その話題で何が話されたかを1文で。決まったこと・割れている点があれば含める。
- now: いま会議全体で焦点になっている論点を1〜2文で。
- direction: 議論全体がどこへ向かっているかを1文で（例：「会場を先に確定させ、それに合わせて予算を組み直す方向」）。
- phase: 議論のいまの状態を選択肢から1つ。
- decided: ここまでに合意・決定したこと（短い箇条書き、なければ空）。はっきり合意した発言があるものだけ。
- open: まだ決まっていない論点（短い箇条書き、なければ空）。
- speakers: 各話者がどんな立場・関心で発言しているかを1文ずつ。発言から読み取れることだけを書き、推測で人物像を作らない。

渡された話題IDと話者名はそのまま使い、新しいものを作らないでください。"""

INSIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "integer"}, "label": {"type": "string"}, "summary": {"type": "string"}},
                "required": ["id", "label", "summary"],
                "additionalProperties": False,
            },
        },
        "now": {"type": "string"},
        "direction": {"type": "string"},
        "phase": {"type": "string", "enum": ["広げている", "深めている", "まとめに向かっている", "意見が割れている", "停滞している"]},
        "decided": {"type": "array", "items": {"type": "string"}},
        "open": {"type": "array", "items": {"type": "string"}},
        "speakers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "stance": {"type": "string"}},
                "required": ["name", "stance"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["topics", "now", "direction", "phase", "decided", "open", "speakers"],
    "additionalProperties": False,
}


def insight_payload(board: Board) -> str:
    line = lambda u: f'{u["speaker"]}: {u["text"]}'
    topics = [{"id": t["id"], "現在の名前": t["label"], "発言数": len(t["utts"]),
               "直近の発言（最大10件）": [line(board.utts[i]) for i in t["utts"][-10:]]}
              for t in board.topics]
    recent = [f'[話題{u["topic"]}] {line(u)}' for u in board.utts[-15:]]
    return json.dumps({"話題": topics, "直近の流れ": recent}, ensure_ascii=False, indent=1)


async def insight_loop(board: Board, dirty: asyncio.Event, publish, enabled: bool = True):
    if not enabled:
        board.status["claude"] = "オフ（ローカルのみ）"
        return
    try:
        import anthropic

        client = anthropic.AsyncAnthropic()
    except Exception as e:
        board.status["claude"] = "未接続（認証情報なし）"
        print(f"[claude] 使えません: {e}")
        return
    board.status["claude"] = CLAUDE_MODEL
    while True:
        await dirty.wait()
        dirty.clear()
        if not board.utts:
            continue
        try:
            resp = await client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=8000,
                system=INSIGHT_SYSTEM,
                messages=[{"role": "user", "content": insight_payload(board)}],
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": INSIGHT_SCHEMA}},
            )
            if resp.stop_reason in ("refusal", "max_tokens"):
                print(f"[claude] 応答が途中で止まりました: {resp.stop_reason}")
            else:
                data = json.loads(next(b.text for b in resp.content if b.type == "text"))
                for t in data["topics"]:
                    if 0 <= t["id"] < len(board.topics):
                        board.topics[t["id"]]["label"] = t["label"]
                        board.topics[t["id"]]["summary"] = t["summary"]
                board.now, board.direction, board.phase = data["now"], data["direction"], data["phase"]
                board.decided, board.open = data["decided"], data["open"]
                board.stances = {s["name"]: s["stance"] for s in data["speakers"]}
                board.status["claude"] = CLAUDE_MODEL
                await publish()
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, TypeError) as e:
            board.status["claude"] = "未接続（APIキーを確認）"
            print(f"[claude] 認証エラーのため停止します: {e}")
            await publish()
            return
        except anthropic.APIError as e:  # 一時的な失敗は次の周期でやり直す
            board.status["claude"] = "一時的に失敗（再試行します）"
            print(f"[claude] {type(e).__name__}: {e}")
            dirty.set()
        await asyncio.sleep(INSIGHT_INTERVAL)


# ---------- サーバー ----------

def build_app(args) -> FastAPI:
    board = Board(Embedder(args.embed), args.threshold)
    clients: set[WebSocket] = set()
    dirty = asyncio.Event()
    log_dir = ROOT / "logs"
    if not args.no_log:
        log_dir.mkdir(exist_ok=True)
    log_path = log_dir / time.strftime("%Y%m%d-%H%M%S.jsonl")

    async def publish():
        msg = json.dumps(board.snapshot(), ensure_ascii=False)
        for ws in list(clients):
            try:
                await ws.send_text(msg)
            except Exception:
                clients.discard(ws)

    async def ingest(speaker: str, text: str):
        text = text.strip()
        if not text:
            return
        utt = board.add(speaker or board.current_speaker, text)
        if not args.no_log:
            with log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(utt, ensure_ascii=False) + "\n")
        dirty.set()
        await publish()

    async def demo():
        await asyncio.sleep(2)
        for raw in (ROOT / "sample" / "demo.txt").read_text(encoding="utf-8").splitlines():
            if ":" in raw:
                name, text = raw.split(":", 1)
                await ingest(name.strip(), text)
                await asyncio.sleep(args.demo_speed)

    @asynccontextmanager
    async def lifespan(app):
        loop = asyncio.get_running_loop()
        tasks = [asyncio.create_task(insight_loop(board, dirty, publish, not args.local))]
        if args.demo:
            board.status["source"] = "サンプル再生"
            tasks.append(asyncio.create_task(demo()))
        elif args.no_mic:
            board.status["source"] = "テキスト入力"
        else:
            try:
                import stt

                stt.start(lambda text: asyncio.run_coroutine_threadsafe(ingest("", text), loop),
                          model=args.whisper, device=args.device)
                board.status["source"] = "マイク"
            except Exception as e:
                board.status["source"] = "マイク起動失敗（テキスト入力のみ）"
                print(f"[mic] 起動できません: {e}")
        yield
        for t in tasks:
            t.cancel()

    app = FastAPI(lifespan=lifespan)

    @app.get("/")
    async def index():
        return FileResponse(ROOT / "static" / "index.html")

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        # ほかのWebサイトのページからこのサーバーへ接続して発言を読まれないよう、接続元を確かめる
        origin = ws.headers.get("origin")
        if origin and origin not in (f"http://localhost:{args.port}", f"http://127.0.0.1:{args.port}"):
            await ws.close(code=1008)
            return
        await ws.accept()
        clients.add(ws)
        await ws.send_text(json.dumps(board.snapshot(), ensure_ascii=False))
        try:
            while True:
                m = json.loads(await ws.receive_text())
                if m.get("type") == "text":
                    await ingest(m.get("speaker", ""), m.get("text", ""))
                elif m.get("type") == "speaker" and m.get("name", "").strip():
                    board.current_speaker = m["name"].strip()
                    if board.current_speaker not in board.extra_speakers:
                        board.extra_speakers.append(board.current_speaker)
                    await publish()
                elif m.get("type") == "reset":
                    board.reset()
                    await publish()
        except WebSocketDisconnect:
            clients.discard(ws)

    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
    return app


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="会話マップ")
    p.add_argument("--demo", action="store_true", help="サンプル会話を再生する（マイク不要）")
    p.add_argument("--demo-speed", type=float, default=2.5, help="サンプル再生の発言間隔（秒）")
    p.add_argument("--no-mic", action="store_true", help="マイクを使わずテキスト入力だけで動かす")
    p.add_argument("--embed", choices=["model", "hash"], default="model", help="hash は簡易版（モデル不要）")
    p.add_argument("--threshold", type=float, default=None, help="同じ話題とみなす類似度（大きいほど話題が細かく分かれる）")
    p.add_argument("--whisper", default="mlx-community/whisper-large-v3-turbo", help="文字起こしモデル")
    p.add_argument("--device", default=None, help="入力デバイス名または番号（既定はシステムの既定マイク）")
    p.add_argument("--local", action="store_true", help="Claude に何も送らず、Mac の中だけで動かす")
    p.add_argument("--no-log", action="store_true", help="発言ログをファイルに保存しない")
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    print(f"\n  ブラウザで開く → http://localhost:{args.port}\n")
    uvicorn.run(build_app(args), host="127.0.0.1", port=args.port, log_level="warning")
