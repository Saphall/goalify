"""Desktop entry point for the macOS app bundle."""
import os
import threading
from pathlib import Path

import webview
from werkzeug.serving import make_server

from goalify import create_app


def main():
    data_dir = Path.home() / "Library" / "Application Support" / "Goalify"
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("GOALIFY_DATABASE", str(data_dir / "goalify.sqlite3"))

    server = make_server("127.0.0.1", 0, create_app(), threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    webview.create_window("Goalify", f"http://127.0.0.1:{server.server_port}", width=1280, height=860, min_size=(420, 640))
    webview.start()
    server.shutdown()


if __name__ == "__main__":
    main()
