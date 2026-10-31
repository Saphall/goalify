"""Command-line entry point for ``uv run app``."""
import argparse

from . import create_app


def main():
    parser = argparse.ArgumentParser(description="Your goals, a little closer.")
    parser.add_argument("--port", type=int, default=5050)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--empty", action="store_true", help="Start a new database without sample goals")
    args = parser.parse_args()
    app = create_app(seed=not args.empty)
    app.run(host=args.host, port=args.port, debug=False)
