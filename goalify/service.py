"""Reusable goal service with SQLite persistence; no web-framework dependency."""
from contextlib import contextmanager
from datetime import date, datetime, timedelta
import math
import sqlite3


CATEGORIES = ("Personal", "Health", "Learning", "Career", "Finance", "Creative")


class ValidationError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class GoalService:
    def __init__(self, database):
        self.database = str(database)

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.database, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def initialize(self, *, seed=True):
        with self.connection() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE IF NOT EXISTS goals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    category TEXT NOT NULL,
                    target REAL NOT NULL CHECK(target > 0),
                    unit TEXT NOT NULL,
                    due_date TEXT,
                    created_at TEXT NOT NULL,
                    sample INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
                    amount REAL NOT NULL CHECK(amount > 0),
                    note TEXT NOT NULL DEFAULT '',
                    logged_on TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS entries_goal ON entries(goal_id);
                CREATE INDEX IF NOT EXISTS entries_date ON entries(logged_on);
            """)
            if conn.execute("SELECT 1 FROM metadata WHERE key = 'initialized'").fetchone():
                return
            if seed:
                self._seed(conn)
            conn.execute("INSERT INTO metadata VALUES ('initialized', '1')")

    def _seed(self, conn):
        today = date.today()
        examples = [
            ("Read 24 books", "Make more room for new perspectives. One chapter at a time.", "Learning", 24, "books", 90, [(12, 3), (8, 2), (4, 2), (1, 1), (0, 1)]),
            ("Run 100 kilometers", "A clearer mind, a stronger body. Find my own pace.", "Health", 100, "km", 35, [(13, 12), (10, 10), (7, 12), (5, 10), (3, 10), (1, 10)]),
            ("Mindful mornings", "Start the day with ten minutes just for myself.", "Personal", 30, "sessions", 20, [(12, 5), (9, 4), (6, 4), (2, 3), (1, 1), (0, 1)]),
            ("Build my portfolio", "Create a collection of work that feels like me.", "Career", 5, "projects", 60, [(11, 1), (6, 1), (2, 1)]),
            ("Finish a Python course", "Turn curiosity into something I can build with.", "Learning", 12, "lessons", -1, [(13, 4), (8, 4), (1, 4)]),
        ]
        for title, description, category, target, unit, days, entries in examples:
            cursor = conn.execute(
                "INSERT INTO goals (title,description,category,target,unit,due_date,created_at,sample) VALUES (?,?,?,?,?,?,?,1)",
                (title, description, category, target, unit, (today + timedelta(days=days)).isoformat(), (today - timedelta(days=20)).isoformat()),
            )
            for offset, amount in entries:
                day = (today - timedelta(days=offset)).isoformat()
                note = "A little progress, a little closer." if offset == 0 else "Showing up for myself."
                conn.execute("INSERT INTO entries (goal_id,amount,note,logged_on,created_at) VALUES (?,?,?,?,?)", (cursor.lastrowid, amount, note, day, day + "T09:00:00"))

    @staticmethod
    def _text(data, field, maximum, *, required=False):
        value = data.get(field, "")
        if not isinstance(value, str):
            raise ValidationError(f"{field.replace('_', ' ').capitalize()} must be text.")
        value = value.strip()
        if required and not value:
            raise ValidationError(f"Please enter a {field.replace('_', ' ')}.")
        if len(value) > maximum:
            raise ValidationError(f"{field.replace('_', ' ').capitalize()} must be {maximum} characters or fewer.")
        return value

    @staticmethod
    def _number(value, label):
        if isinstance(value, bool):
            raise ValidationError(f"{label} must be a positive number.")
        try:
            value = float(value)
        except (TypeError, ValueError, OverflowError):
            raise ValidationError(f"{label} must be a positive number.") from None
        if not math.isfinite(value) or value <= 0 or value > 1_000_000_000:
            raise ValidationError(f"{label} must be greater than 0 and at most 1 billion.")
        value = round(value, 4)
        if value <= 0:
            raise ValidationError(f"{label} must be at least 0.0001.")
        return value

    def _goal_data(self, data):
        result = {
            "title": self._text(data, "title", 100, required=True),
            "description": self._text(data, "description", 500),
            "category": self._text(data, "category", 30, required=True),
            "target": self._number(data.get("target"), "Target"),
            "unit": self._text(data, "unit", 30, required=True),
        }
        if result["category"] not in CATEGORIES:
            raise ValidationError("Please choose a valid category.")
        due = data.get("due_date") or None
        if due is not None:
            try:
                due = date.fromisoformat(due).isoformat()
            except (ValueError, TypeError):
                raise ValidationError("Please choose a valid target date.") from None
        result["due_date"] = due
        return result

    @staticmethod
    def _get_goal(conn, goal_id):
        row = conn.execute("SELECT g.*, COALESCE(SUM(e.amount),0) AS current FROM goals g LEFT JOIN entries e ON e.goal_id=g.id WHERE g.id=? GROUP BY g.id", (goal_id,)).fetchone()
        if row is None:
            raise ValidationError("This goal could not be found.", 404)
        goal = dict(row)
        goal["current"] = round(goal["current"], 4)
        return goal

    def create_goal(self, data):
        goal = self._goal_data(data)
        with self.connection() as conn:
            cursor = conn.execute("INSERT INTO goals (title,description,category,target,unit,due_date,created_at) VALUES (:title,:description,:category,:target,:unit,:due_date,:created_at)", {**goal, "created_at": datetime.now().isoformat(timespec="seconds")})
            return self._get_goal(conn, cursor.lastrowid)

    def edit_goal(self, goal_id, data):
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            old = self._get_goal(conn, goal_id)
            goal = self._goal_data({**old, **data})
            if goal["target"] < old["current"]:
                raise ValidationError("The target cannot be lower than your logged progress. Undo an entry first.")
            conn.execute("UPDATE goals SET title=:title,description=:description,category=:category,target=:target,unit=:unit,due_date=:due_date WHERE id=:id", {**goal, "id": goal_id})
            return self._get_goal(conn, goal_id)

    def delete_goal(self, goal_id):
        with self.connection() as conn:
            self._get_goal(conn, goal_id)
            conn.execute("DELETE FROM goals WHERE id=?", (goal_id,))

    def log_progress(self, goal_id, data):
        amount = self._number(data.get("amount"), "Progress")
        note = self._text(data, "note", 500)
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            goal = self._get_goal(conn, goal_id)
            remaining = round(goal["target"] - goal["current"], 4)
            if amount > remaining:
                raise ValidationError(f"You have {remaining:g} {goal['unit']} left. Please log that amount or less.")
            now = datetime.now()
            conn.execute("INSERT INTO entries (goal_id,amount,note,logged_on,created_at) VALUES (?,?,?,?,?)", (goal_id, amount, note, now.date().isoformat(), now.isoformat(timespec="microseconds")))
            return self._get_goal(conn, goal_id)

    def delete_entry(self, entry_id):
        with self.connection() as conn:
            result = conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
            if not result.rowcount:
                raise ValidationError("This entry could not be found.", 404)

    def clear_samples(self):
        with self.connection() as conn:
            conn.execute("DELETE FROM goals WHERE sample=1")

    def dashboard(self):
        today = date.today()
        with self.connection() as conn:
            goals = [dict(row) for row in conn.execute("SELECT g.*, COALESCE(SUM(e.amount),0) AS current, MAX(e.logged_on) AS last_logged FROM goals g LEFT JOIN entries e ON e.goal_id=g.id GROUP BY g.id ORDER BY g.id")]
            entries = [dict(row) for row in conn.execute("SELECT e.*,g.title,g.unit,g.category FROM entries e JOIN goals g ON g.id=e.goal_id ORDER BY e.created_at DESC,e.id DESC")]
        for goal in goals:
            goal["current"] = round(goal["current"], 4)
            goal["completed"] = goal["current"] >= goal["target"]
            # Reserve 100% for completed goals, even for very small final steps.
            goal["progress"] = 100 if goal["completed"] else min(99, round(goal["current"] / goal["target"] * 100))
            goal["days_left"] = (date.fromisoformat(goal["due_date"]) - today).days if goal["due_date"] else None
        days = {entry["logged_on"] for entry in entries}
        cursor = today if today.isoformat() in days else today - timedelta(days=1)
        streak = 0
        while cursor.isoformat() in days:
            streak += 1
            cursor -= timedelta(days=1)
        weekly = []
        for offset in range(6, -1, -1):
            day = today - timedelta(days=offset)
            weekly.append({"date": day.isoformat(), "label": day.strftime("%a"), "count": sum(e["logged_on"] == day.isoformat() for e in entries)})
        return {
            "goals": goals, "entries": entries, "categories": CATEGORIES,
            "today": today.isoformat(), "weekly": weekly,
            "stats": {
                "active": sum(not g["completed"] for g in goals),
                "completed": sum(g["completed"] for g in goals),
                "progress": round(sum(g["progress"] for g in goals) / len(goals)) if goals else 0,
                "streak": streak,
                "today_entries": sum(e["logged_on"] == today.isoformat() for e in entries),
                "week_entries": sum(d["count"] for d in weekly),
                "has_samples": any(g["sample"] for g in goals),
            },
        }
