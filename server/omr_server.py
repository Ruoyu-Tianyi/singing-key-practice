#!/usr/bin/env python3
"""Optional loopback-only Audiveris adapter. No Python dependencies required."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import threading
import zipfile
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_UPLOAD = 20 * 1024 * 1024
MAX_EXPORT = 32 * 1024 * 1024
TIMEOUT = 180
ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
ALLOWED_ORIGINS = set(os.environ.get("OMR_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","))
RUNNING = threading.BoundedSemaphore(1)


def audiveris_command() -> str | None:
    configured = os.environ.get("AUDIVERIS_BIN")
    return str(Path(configured).resolve()) if configured else (shutil.which("Audiveris") or shutil.which("audiveris"))


def extract_musicxml(path: Path) -> bytes:
    if path.stat().st_size > MAX_EXPORT:
        raise ValueError("识别结果超过 32 MB，请分段识别。")
    if path.suffix.lower() != ".mxl":
        return path.read_bytes()
    # Read in memory without extracting paths supplied by an archive.
    with zipfile.ZipFile(path) as archive:
        candidates = [item for item in archive.infolist() if item.filename.lower().endswith((".xml", ".musicxml")) and not item.filename.startswith("META-INF/")]
        if not candidates:
            raise ValueError("Audiveris 导出文件没有 MusicXML。")
        if candidates[0].file_size > MAX_EXPORT:
            raise ValueError("解压后的 MusicXML 超过 32 MB。")
        return archive.read(candidates[0])


def stop_process(process: subprocess.Popen) -> None:
    if os.name == "nt":
        # Kill the Java child as well as the launch wrapper. PID is ours, never input.
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=10)


def recognize(content: bytes, suffix: str) -> bytes:
    executable = audiveris_command()
    if not executable or not Path(executable).is_file():
        raise FileNotFoundError("未找到 Audiveris。请安装 Audiveris 和所需 Java，并设置 AUDIVERIS_BIN 为启动程序的绝对路径。")
    with tempfile.TemporaryDirectory(prefix="singing-omr-") as work:
        directory = Path(work)
        source = directory / ("input" + suffix)
        output = directory / "output"
        output.mkdir()
        source.write_bytes(content)
        # All arguments except the server-configured executable are generated here.
        # File names and flags are never taken from the uploaded file or a request.
        command = [executable, "-batch", "-export", "-output", str(output), "--", str(source)]
        environment = os.environ.copy()
        environment["JAVA_TOOL_OPTIONS"] = (environment.get("JAVA_TOOL_OPTIONS", "") + " -Xmx1536m -Djava.awt.headless=true").strip()
        process = subprocess.Popen(command, cwd=directory, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=False, start_new_session=os.name != "nt", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            status = process.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            stop_process(process)
            raise TimeoutError("识别超过 180 秒，已停止任务。请裁剪页面或分段上传。")
        if status:
            raise ValueError("Audiveris 识别失败。请先用 Audiveris 桌面版检查原谱，或手动导出 MusicXML。")
        results = sorted(output.rglob("*.mxl")) + sorted(output.rglob("*.musicxml")) + sorted(output.rglob("*.xml"))
        if not results:
            raise ValueError("没有生成 MusicXML。Audiveris 适用于清晰的印刷五线谱，不适用于简谱或所有手写谱。")
        if len(results) > 1:
            raise ValueError("生成了多个分曲，请使用 Audiveris 桌面版分别导出并逐个导入，以免遗漏曲目。")
        return extract_musicxml(results[0])


class Handler(BaseHTTPRequestHandler):
    server_version = "SingingOMR/1.0"

    def permitted(self) -> bool:
        host = self.headers.get("Host", "").split(":")[0].lower()
        origin = self.headers.get("Origin")
        if host not in {"127.0.0.1", "localhost"}:
            self.reply(403, "服务仅允许本机访问。")
            return False
        if origin and origin not in ALLOWED_ORIGINS:
            self.reply(403, "此网页来源未获允许，请配置 OMR_ALLOWED_ORIGINS。")
            return False
        return True

    def reply(self, status: int, body: str | bytes, content_type: str = "text/plain; charset=utf-8") -> None:
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Local Network Access (where the browser permits loopback from HTTPS).
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        if self.permitted():
            self.reply(204, b"")

    def do_GET(self) -> None:
        if not self.permitted():
            return
        if self.path != "/health":
            self.reply(404, "未找到此接口。")
            return
        self.reply(200, json.dumps({"service": "Audiveris OMR", "configured": bool(audiveris_command()), "maxUploadMB": 20, "timeoutSeconds": TIMEOUT}), "application/json; charset=utf-8")

    def do_POST(self) -> None:
        if not self.permitted():
            return
        if self.path != "/api/recognize":
            self.reply(404, "未找到此接口。")
            return
        if not RUNNING.acquire(blocking=False):
            self.reply(429, "已有识别任务在进行，请稍后重试。")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_UPLOAD + 65536:
                self.reply(413, "文件为空或超过 20 MB。")
                return
            content_type = self.headers.get("Content-Type", "")
            if not content_type.startswith("multipart/form-data;") or len(content_type) > 500:
                self.reply(415, "请使用 multipart/form-data 上传 file 字段。")
                return
            self.connection.settimeout(30)
            content = self.rfile.read(length)
            if len(content) != length:
                self.reply(400, "上传未完成。")
                return
            message = BytesParser(policy=default).parsebytes(b"Content-Type: " + content_type.encode("ascii") + b"\r\nMIME-Version: 1.0\r\n\r\n" + content)
            attachments = [part for part in message.iter_parts() if part.get_param("name", header="content-disposition") == "file"]
            if len(attachments) != 1:
                self.reply(400, "请上传且只上传一个 file 文件。")
                return
            attachment = attachments[0]
            suffix = Path(attachment.get_filename() or "").suffix.lower()
            data = attachment.get_payload(decode=True) or b""
            if suffix not in ALLOWED_SUFFIXES:
                self.reply(415, "支持 PDF、PNG、JPEG、TIFF 和 BMP。")
                return
            if not data or len(data) > MAX_UPLOAD:
                self.reply(413, "文件为空或超过 20 MB。")
                return
            self.reply(200, recognize(data, suffix), "application/vnd.recordare.musicxml+xml; charset=utf-8")
        except FileNotFoundError as error:
            self.reply(503, str(error))
        except TimeoutError as error:
            self.reply(504, str(error))
        except (ValueError, UnicodeError, zipfile.BadZipFile) as error:
            self.reply(422, str(error))
        except Exception:
            self.reply(500, "本地识别服务出错。请检查 Audiveris 安装和本机资源。")
        finally:
            RUNNING.release()


if __name__ == "__main__":
    port = int(os.environ.get("OMR_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Audiveris adapter: http://127.0.0.1:{port}/api/recognize", flush=True)
    print("Local computer only; press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
