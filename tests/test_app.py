"""Persistence and API regression tests; each test uses a temporary database."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
import tempfile
import unittest

from goalify import create_app
from goalify.service import GoalService, ValidationError


class GoalifyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.database = Path(self.temp.name) / "test.sqlite3"
        self.app = create_app(self.database, seed=False)
        self.client = self.app.test_client()
        self.service = self.app.extensions["goals"]

    def create(self, **overrides):
        response = self.client.post("/api/goals", json={
            "title": "Read more", "description": "A new perspective",
            "category": "Learning", "target": 3, "unit": "books",
            "due_date": (date.today() + timedelta(days=30)).isoformat(),
            **overrides,
        })
        self.assertEqual(response.status_code, 201, response.json)
        return response.json["id"]

    def dashboard(self):
        response = self.client.get("/api/dashboard")
        self.assertEqual(response.status_code, 200)
        return response.json

    def test_goal_lifecycle_and_undo(self):
        goal_id = self.create()
        response = self.client.post(f"/api/goals/{goal_id}/entries", json={"amount": 3, "note": "Done!"})
        self.assertEqual(response.status_code, 201)
        data = self.dashboard()
        self.assertEqual(data["stats"]["completed"], 1)
        self.assertEqual(data["stats"]["active"], 0)
        self.assertEqual(data["stats"]["progress"], 100)
        self.assertEqual(data["stats"]["streak"], 1)
        self.assertEqual(data["entries"][0]["note"], "Done!")
        entry_id = data["entries"][0]["id"]
        self.assertEqual(self.client.delete(f"/api/entries/{entry_id}").status_code, 204)
        self.assertFalse(self.dashboard()["goals"][0]["completed"])
        self.assertEqual(self.dashboard()["stats"]["streak"], 0)
        self.client.post(f"/api/goals/{goal_id}/entries", json={"amount": 1})
        self.assertEqual(self.client.delete(f"/api/goals/{goal_id}").status_code, 204)
        self.assertEqual(self.dashboard()["goals"], [])
        self.assertEqual(self.dashboard()["entries"], [])

    def test_persistence_and_no_reseed_on_restart(self):
        goal_id = self.create(title="My real goal")
        restarted = create_app(self.database, seed=True).test_client()
        goals = restarted.get("/api/dashboard").json["goals"]
        self.assertEqual(len(goals), 1)
        self.assertEqual(goals[0]["id"], goal_id)
        self.assertEqual(goals[0]["title"], "My real goal")
        self.assertFalse(goals[0]["sample"])

    def test_invalid_goal_data(self):
        for changes in [
            {"title": "   "}, {"title": "a" * 101}, {"title": 42},
            {"target": -1}, {"target": 0}, {"target": "NaN"},
            {"target": "Infinity"}, {"target": True}, {"target": 0.000001},
            {"target": 1000000001}, {"category": "Invalid"},
            {"unit": ""}, {"due_date": "2026-02-30"},
        ]:
            with self.subTest(changes=changes):
                response = self.client.post("/api/goals", json={"title": "A goal", "category": "Personal", "target": 5, "unit": "steps", **changes})
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.json)
        self.assertEqual(self.dashboard()["goals"], [])

    def test_log_validation_and_edit_preserve_progress(self):
        goal_id = self.create()
        for amount in [0, -1, "NaN", "Infinity", True, 4, None]:
            with self.subTest(amount=amount):
                self.assertEqual(self.client.post(f"/api/goals/{goal_id}/entries", json={"amount": amount}).status_code, 400)
        self.client.post(f"/api/goals/{goal_id}/entries", json={"amount": 2})
        self.assertEqual(self.client.patch(f"/api/goals/{goal_id}", json={"target": 1}).status_code, 400)
        response = self.client.patch(f"/api/goals/{goal_id}", json={"title": "A better title", "target": 4})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["current"], 2)
        self.assertEqual(response.json["title"], "A better title")
        self.assertEqual(self.dashboard()["goals"][0]["progress"], 50)

    def test_decimal_progress_and_target(self):
        goal_id = self.create(target=0.8, unit="km")
        for amount in [0.1, 0.7]:
            response = self.client.post(f"/api/goals/{goal_id}/entries", json={"amount": amount})
            self.assertEqual(response.status_code, 201)
        response = self.client.patch(f"/api/goals/{goal_id}", json={"target": 0.8})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.dashboard()["goals"][0]["completed"])

    def test_rounded_percentage_does_not_imply_completion(self):
        goal_id = self.create(target=1000)
        self.service.log_progress(goal_id, {"amount": 999.9999})
        goal = self.dashboard()["goals"][0]
        self.assertFalse(goal["completed"])
        self.assertEqual(goal["progress"], 99)
        self.service.log_progress(goal_id, {"amount": 0.0001})
        self.assertTrue(self.dashboard()["goals"][0]["completed"])

    def test_sample_cleanup_preserves_user_goals(self):
        sample_db = Path(self.temp.name) / "samples.sqlite3"
        service = GoalService(sample_db)
        service.initialize(seed=True)
        self.assertEqual(len(service.dashboard()["goals"]), 5)
        goal = service.create_goal({"title": "Keep this", "category": "Health", "target": 2, "unit": "walks"})
        service.log_progress(goal["id"], {"amount": 1, "note": "My own progress"})
        service.clear_samples()
        data = service.dashboard()
        self.assertEqual(len(data["goals"]), 1)
        self.assertEqual(data["goals"][0]["title"], "Keep this")
        self.assertEqual(len(data["entries"]), 1)
        self.assertFalse(data["stats"]["has_samples"])
        service.initialize(seed=True)
        self.assertEqual(len(service.dashboard()["goals"]), 1)

    def test_streak_and_weekly_totals(self):
        goal_id = self.create(target=20)
        today = date.today()
        with self.service.connection() as conn:
            for offset in [1, 2, 3, 5, 10]:
                day = (today - timedelta(days=offset)).isoformat()
                conn.execute("INSERT INTO entries (goal_id,amount,note,logged_on,created_at) VALUES (?,1,'',?,?)", (goal_id, day, day + "T09:00:00"))
        data = self.dashboard()
        self.assertEqual(data["stats"]["streak"], 3)
        self.assertEqual(data["stats"]["week_entries"], 4)
        self.assertEqual(data["stats"]["today_entries"], 0)
        self.service.log_progress(goal_id, {"amount": 1})
        self.assertEqual(self.dashboard()["stats"]["streak"], 4)

    def test_concurrent_checkins_cannot_exceed_target(self):
        goal_id = self.create(target=1)
        def log():
            try:
                self.service.log_progress(goal_id, {"amount": 1})
                return True
            except ValidationError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: log(), range(2)))
        self.assertEqual(sum(results), 1)
        self.assertEqual(self.dashboard()["goals"][0]["current"], 1)

    def test_json_errors_and_unknown_records(self):
        self.assertEqual(self.client.post("/api/goals", json=[]).status_code, 400)
        self.assertEqual(self.client.post("/api/goals", data="bad").status_code, 400)
        self.assertEqual(self.client.delete("/api/goals/999").status_code, 404)
        self.assertEqual(self.client.delete("/api/entries/999").status_code, 404)
        self.assertEqual(self.client.patch("/api/goals/999", json={}).status_code, 404)
        self.assertEqual(self.client.get("/api/unknown").status_code, 404)
        self.assertIn("error", self.client.get("/api/unknown").json)

    def test_page_and_assets(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"goalify", response.data)
        self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        for asset in ["app.js", "style.css", "favicon.svg"]:
            with self.client.get(f"/static/{asset}") as response:
                self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
