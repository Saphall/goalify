"""Real-browser flows on an isolated database. Run from the project root."""
from pathlib import Path
import json
import os
import shutil
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from playwright.sync_api import expect, sync_playwright
from werkzeug.serving import make_server

from goalify import create_app


def main():
    output = Path("test-results")
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        app = create_app(Path(temp) / "browser.sqlite3")
        server = make_server("127.0.0.1", 0, app, threaded=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}"
        try:
            with sync_playwright() as playwright:
                chrome = os.environ.get("GOALIFY_CHROME") or shutil.which("google-chrome") or shutil.which("chromium")
                browser = playwright.chromium.launch(executable_path=chrome, headless=True)
                context = browser.new_context(viewport={"width": 1440, "height": 1080}, reduced_motion="reduce")
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                response = page.goto(url)
                assert response.status == 200
                expect(page.locator(".goal-card")).to_have_count(4)
                expect(page.get_by_text("Small steps.", exact=False)).to_be_visible()
                page.screenshot(path=str(output / "overview-desktop.png"), full_page=True)

                for width in [390, 768, 1024, 1440]:
                    page.set_viewport_size({"width": width, "height": 900})
                    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"Overflow at {width}px"
                    if width == 390:
                        page.screenshot(path=str(output / "overview-mobile.png"), full_page=True)
                        page.get_by_role("button", name="Open navigation").click()
                        page.get_by_role("link", name="My goals").click()
                        expect(page.locator("#sidebar")).not_to_have_class("sidebar open")
                        expect(page.locator(".goal-card")).to_have_count(5)
                        page.goto(url)
                        expect(page.locator(".goal-card")).to_have_count(4)

                page.set_viewport_size({"width": 390, "height": 844})
                page.locator("#new-goal").click()
                page.get_by_label("Give your goal a name").fill("Learn watercolor")
                page.get_by_label("Your reason why").fill("A little color <b>every day</b>.")
                page.get_by_label("Your target", exact=True).fill("2")
                page.get_by_label("Measured in").fill("sessions")
                page.get_by_label("A part of your life").select_option("Creative")
                assert page.locator("#modal").evaluate("el => el.scrollWidth <= el.clientWidth"), "Mobile goal dialog overflows"
                page.screenshot(path=str(output / "new-goal-mobile.png"), full_page=True)
                page.get_by_role("button", name="Plant this goal").click()
                expect(page.locator("#modal")).not_to_be_visible()
                page.set_viewport_size({"width": 1440, "height": 1080})
                page.get_by_role("link", name="My goals").click()
                card = page.locator(".goal-card").filter(has_text="Learn watercolor")
                expect(card).to_be_visible()
                expect(card.locator(".goal-description")).to_have_text("A little color <b>every day</b>.")
                assert card.locator(".goal-description b").count() == 0
                card.get_by_role("button", name="Log progress").click()
                page.get_by_label("How much progress did you make?").fill("1")
                page.get_by_label("Leave a little note").fill("First brush strokes.")
                page.get_by_role("button", name="Save my progress").click()
                expect(card.locator(".goal-progress-label strong")).to_have_text("50%")
                card.get_by_role("button", name="Learn watercolor", exact=True).click()
                page.get_by_role("button", name="Edit", exact=True).click()
                page.get_by_label("Give your goal a name").fill("Learn watercolor slowly")
                page.get_by_role("button", name="Save changes").click()
                expect(card).to_contain_text("Learn watercolor slowly")
                card.get_by_role("button", name="Log progress").click()
                page.get_by_role("button", name="Save my progress").click()
                expect(card).to_contain_text("Completed")
                page.get_by_role("button", name="Completed", exact=True).click()
                expect(page.locator(".goal-card")).to_have_count(2)
                card.get_by_role("button", name="Learn watercolor slowly", exact=True).click()
                page.get_by_role("button", name="Undo this entry").first.click()
                page.get_by_role("button", name="Undo check-in", exact=True).click()
                expect(page.locator("#modal")).not_to_be_visible()
                expect(page.locator(".goal-card")).to_have_count(1)
                page.get_by_role("button", name="All goals", exact=True).click()
                page.get_by_label("Search goals").fill("watercolor")
                expect(page.locator(".goal-card")).to_have_count(1)
                page.get_by_label("Filter by category").select_option("Health")
                expect(page.get_by_text("A little less specific?")).to_be_visible()
                page.get_by_role("button", name="Clear filters").click()
                expect(page.locator(".goal-card")).to_have_count(6)
                page.get_by_label("Sort goals").select_option("progress")

                page.get_by_role("link", name="Insights", exact=True).click()
                expect(page.get_by_role("heading", name="Your weekly rhythm")).to_be_visible()
                page.screenshot(path=str(output / "insights-desktop.png"), full_page=True)
                page.get_by_role("link", name="Progress journal", exact=True).click()
                expect(page.get_by_text("First brush strokes.")).to_be_visible()
                with page.expect_download() as download:
                    page.get_by_role("button", name="Export JSON").click()
                exported = json.loads(Path(download.value.path()).read_text())
                assert any(g["title"] == "Learn watercolor slowly" for g in exported["goals"])
                assert any(e["note"] == "First brush strokes." for e in exported["entries"])

                page.get_by_role("link", name="My goals").click()
                page.get_by_role("button", name="Clear samples", exact=True).click()
                page.get_by_role("button", name="Clear sample goals", exact=True).click()
                expect(page.locator(".goal-card")).to_have_count(1)
                page.reload()
                expect(page.locator(".goal-card")).to_have_count(1)
                expect(page.locator(".goal-card")).to_contain_text("50%")
                page.get_by_role("button", name="Learn watercolor slowly", exact=True).click()
                page.get_by_role("button", name="Delete goal", exact=True).click()
                page.get_by_role("button", name="Delete goal", exact=True).click()
                expect(page.get_by_text("Make space for something good")).to_be_visible()
                page.get_by_role("link", name="Overview", exact=True).click()
                expect(page.get_by_text("Make space for something good")).to_be_visible()
                assert not errors, "Browser errors: " + repr(errors)
                browser.close()
                print("PASS: responsive layouts, creation, safe text rendering, progress, editing, completion, undo, filters, insights, journal export, sample cleanup, persistence, deletion, and empty states.")
                print(f"Screenshots: {output.resolve()}")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
