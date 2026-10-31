"""HTTP adapter. Goal logic and storage live independently in service.py."""
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from .service import GoalService, ValidationError


def create_app(database=None, *, seed=True):
    app = Flask(__name__, instance_relative_config=True)
    app.config.update(MAX_CONTENT_LENGTH=32 * 1024, JSON_SORT_KEYS=False)
    database = database or os.environ.get("GOALIFY_DATABASE") or Path(app.instance_path) / "goalify.sqlite3"
    Path(database).parent.mkdir(parents=True, exist_ok=True)
    service = GoalService(database)
    service.initialize(seed=seed)
    app.extensions["goals"] = service

    def payload():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise ValidationError("Please send a JSON object.")
        return data

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/dashboard")
    def dashboard():
        return jsonify(service.dashboard())

    @app.post("/api/goals")
    def create_goal():
        return jsonify(service.create_goal(payload())), 201

    @app.patch("/api/goals/<int:goal_id>")
    def edit_goal(goal_id):
        return jsonify(service.edit_goal(goal_id, payload()))

    @app.delete("/api/goals/<int:goal_id>")
    def delete_goal(goal_id):
        service.delete_goal(goal_id)
        return "", 204

    @app.post("/api/goals/<int:goal_id>/entries")
    def log_progress(goal_id):
        return jsonify(service.log_progress(goal_id, payload())), 201

    @app.delete("/api/entries/<int:entry_id>")
    def undo_progress(entry_id):
        service.delete_entry(entry_id)
        return "", 204

    @app.delete("/api/samples")
    def clear_samples():
        service.clear_samples()
        return "", 204

    @app.errorhandler(ValidationError)
    def invalid(error):
        return jsonify(error=str(error)), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        if request.path.startswith("/api/"):
            return jsonify(error=error.description), error.code
        return error

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    return app

