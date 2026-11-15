"""マイク → 発話の切り出し → Whisper で文字起こし（すべてローカル）。"""
import queue
import threading

import numpy as np

RATE = 16000
BLOCK = 480  # 30ms
SILENCE_END = 0.7  # これだけ無音が続いたら発話の終わりとみなす（秒）
MAX_LEN = 12.0  # 長い発話はここで区切る（秒）
MIN_LEN = 0.4

# 無音や雑音に対して Whisper が出しがちな定型文
HALLUCINATIONS = ("ご視聴ありがとうございました", "チャンネル登録", "最後までご覧いただき", "字幕")


def load_transcriber(model: str):
    try:
        import mlx_whisper

        def run(audio: np.ndarray) -> str:
            r = mlx_whisper.transcribe(audio, path_or_hf_repo=model, language="ja",
                                       condition_on_previous_text=False)
            return r["text"]

        return run
    except ImportError:
        from faster_whisper import WhisperModel  # Intel Mac など mlx が使えない環境向け

        m = WhisperModel("small", compute_type="int8")

        def run(audio: np.ndarray) -> str:
            segs, _ = m.transcribe(audio, language="ja", condition_on_previous_text=False)
            return "".join(s.text for s in segs)

        return run


class Segmenter:
    """音量ベースの簡易な発話区間検出。30ms のブロックを受け取り、発話が終わるとその音声を返す。"""

    def __init__(self):
        self.noise = 0.005
        self.buf: list[np.ndarray] = []
        self.silence = 0.0
        self.spoken = 0.0
        self.active = False

    def feed(self, block: np.ndarray):
        rms = float(np.sqrt(np.mean(block**2)))
        loud = rms > max(self.noise * 3.0, 0.008)
        if not self.active:
            self.noise = 0.95 * self.noise + 0.05 * rms  # 静かな間に環境音のレベルを追従
            if not loud:
                self.buf = self.buf[-6:] + [block]  # 語頭が欠けないよう直前を少し保持
                return None
            self.active, self.silence, self.spoken = True, 0.0, 0.0
        self.buf.append(block)
        self.silence = 0.0 if loud else self.silence + len(block) / RATE
        self.spoken += len(block) / RATE if loud else 0.0
        length = sum(len(b) for b in self.buf) / RATE
        if self.silence >= SILENCE_END or length >= MAX_LEN:
            audio = np.concatenate(self.buf)
            self.buf, self.active = [], False
            return audio if self.spoken >= MIN_LEN else None
        return None


def start(on_text, model: str, device=None):
    import sounddevice as sd

    transcribe = load_transcriber(model)
    blocks: queue.Queue = queue.Queue()
    segments: queue.Queue = queue.Queue()

    if isinstance(device, str) and device.isdigit():
        device = int(device)
    stream = sd.InputStream(samplerate=RATE, channels=1, dtype="float32", blocksize=BLOCK, device=device,
                            callback=lambda data, *_: blocks.put(data[:, 0].copy()))
    stream.start()

    def cut():
        seg = Segmenter()
        while True:
            audio = seg.feed(blocks.get())
            if audio is not None:
                segments.put(audio)

    def recognize():
        while True:
            text = transcribe(segments.get()).strip()
            if text and not any(h in text for h in HALLUCINATIONS):
                on_text(text)

    threading.Thread(target=cut, daemon=True).start()
    threading.Thread(target=recognize, daemon=True).start()
    return stream
