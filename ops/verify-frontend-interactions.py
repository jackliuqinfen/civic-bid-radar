"""Browser acceptance for a local, fixture-only self-host instance."""

import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


PROBE = """
() => {
  const frames = [], shifts = [], tasks = [];
  const start = performance.now();
  let previous;
  let frame;
  const sample = t => {
    if (previous !== undefined) frames.push(t - previous);
    previous = t;
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  const observers = [
    new PerformanceObserver(list => shifts.push(...list.getEntries().map(e =>
      ({value: e.value, recentInput: e.hadRecentInput})))),
    new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration))),
  ];
  observers[0].observe({type: "layout-shift"});
  observers[1].observe({type: "longtask"});
  window.finishInteractionProbe = () => {
    cancelAnimationFrame(frame);
    observers.forEach(observer => observer.disconnect());
    frames.sort((a, b) => a - b);
    const percentile = p => frames[Math.floor((frames.length - 1) * p)] || 0;
    return { elapsedMs: performance.now() - start, frames: frames.length,
      medianFrameMs: percentile(0.5), p95FrameMs: percentile(0.95), maxFrameMs: frames.at(-1),
      framesOver33Ms: frames.filter(ms => ms > 33.4).length, longTasksOver50Ms: tasks,
      layoutShiftEvents: shifts.length,
      layoutShiftWithoutRecentInput: shifts.filter(e => !e.recentInput).reduce((sum, e) => sum + e.value, 0) };
  };
}
"""


def metrics(cdp):
    return {value["name"]: value["value"] for value in cdp.send("Performance.getMetrics")["metrics"]}


def measure(page, cdp, name, actions):
    before = metrics(cdp)
    page.evaluate(PROBE)
    actions()
    page.wait_for_timeout(250)
    result = page.evaluate("window.finishInteractionProbe()")
    after = metrics(cdp)
    for key in ("LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration"):
        delta = after[key] - before[key]
        result[key] = round(delta * 1000, 3) if key.endswith("Duration") else int(delta)
    result["scenario"] = name
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:34873")
    parser.add_argument("--credentials", help="A local JSON with username and password. Alternatively set RADAR_QA_USERNAME and RADAR_QA_PASSWORD.")
    parser.add_argument("--browser", default=os.getenv("RADAR_QA_BROWSER", "chrome"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    origin = urlsplit(args.base)
    if origin.scheme != "http" or origin.hostname not in {"127.0.0.1", "localhost"}:
        parser.error("Only a local fixture service is permitted")
    credentials = (
        json.loads(Path(args.credentials).read_text(encoding="utf-8"))
        if args.credentials
        else {"username": os.environ["RADAR_QA_USERNAME"], "password": os.environ["RADAR_QA_PASSWORD"]}
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    scenarios = []
    errors = []
    commands = []
    report = {"source": "Isolated self-host fixture and deliberate browser request fault injection"}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.browser, headless=not args.headed)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        context.route("**/*", lambda route: route.continue_() if urlsplit(route.request.url).netloc == origin.netloc else route.abort())
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.base + "/opportunities?tab=all&onlyOpen=0")
        page.locator("#lg-user").fill(credentials["username"])
        page.locator("#lg-pass").fill(credentials["password"])
        page.locator("#btn-login-submit").click()
        rows = page.locator(".row-chk")
        expect(rows.first).to_be_visible()
        row_count = rows.count()
        assert row_count >= 20, f"Expected a long representative page, found {row_count} rows"
        cdp = context.new_cdp_session(page)
        cdp.send("Performance.enable")
        report.update({
            "browser": browser.version,
            "mode": "headed" if args.headed else "headless",
            "rowsOnPage": row_count,
            "desktopViewport": [1440, 900],
            "coarseTouchViewport": [390, 844],
            "method": "requestAnimationFrame cadence, LayoutShift/LongTask observers, CDP Performance metrics",
            "limits": "Local Chromium sample. Frame timestamps include automation and waiting. No physical display refresh or on-device FPS measurement.",
        })
        scenarios.append(measure(page, cdp, "idle reference", lambda: page.wait_for_timeout(500)))
        report["idleCadenceHz"] = round(1000 / scenarios[0]["medianFrameMs"], 1)
        peek = page.locator("button[data-peek]").first
        peek.focus()

        def open_close():
            page.keyboard.press("Enter")
            expect(page.locator("#pk-close-2")).to_be_focused()
            page.keyboard.press("Tab")
            assert page.evaluate("document.activeElement.closest('[role=dialog]') !== null")
            page.keyboard.press("Escape")
            expect(peek).to_be_focused()
            assert not page.locator("#root").evaluate("(element) => element.inert")

        scenarios.append(measure(page, cdp, "light: keyboard open, wrap and close", open_close))
        page.locator("#btn-cmd-palette").click()
        expect(page.locator("#cmd-q")).to_be_focused()
        page.mouse.click(4, 4)
        expect(page.locator("#btn-cmd-palette")).to_be_focused()
        expect(page.locator(".cmd-overlay")).to_have_count(0)
        theme = page.locator("#btn-theme")
        filter_input = page.locator('#filter-form input[name="q"]')
        filter_input.evaluate("(input) => input.value = '虚构未提交筛选'")
        theme.click()
        expect(theme).to_be_focused()
        expect(theme).to_have_attribute("aria-pressed", "true")
        expect(filter_input).to_have_value("虚构未提交筛选")
        peek.focus()
        scenarios.append(measure(page, cdp, "dark: keyboard open and close", open_close))

        def slow_peek(route):
            commands.append("slow detail")
            page.wait_for_timeout(850)
            route.continue_()

        page.route("**/api/opportunities/*", slow_peek, times=1)

        def reverse_while_loading():
            peek.focus()
            page.keyboard.press("Enter")
            expect(page.locator("#pk-body")).to_have_attribute("aria-busy", "true")
            page.keyboard.press("Escape")
            expect(peek).to_be_focused()
            page.keyboard.press("Enter")
            expect(page.locator("#pk-close-2")).to_be_visible()
            page.keyboard.press("Escape")
            expect(peek).to_be_focused()

        scenarios.append(measure(page, cdp, "rapid open, close and reopen with slow detail", reverse_while_loading))
        page.locator(".row-chk").first.check()
        page.locator("#bulk-decline").click()
        reason = page.locator("#rk-reason")
        reason.fill("隔离验收模拟失败并保留输入")
        expect(reason).to_be_focused()

        def reject_mutation(route):
            commands.append("rejected mutation")
            page.wait_for_timeout(900)
            route.fulfill(status=503, json={"message": "虚构服务暂不可用，请重试"})

        page.route("**/api/opportunities/batch-follow", reject_mutation)

        def repeat_rejected_submit():
            page.keyboard.press("Enter")
            expect(page.locator("#rk-submit")).to_have_attribute("aria-busy", "true")
            page.keyboard.press("Enter")
            page.keyboard.press("Escape")
            page.mouse.click(4, 4)
            expect(page.locator("#rk-err")).to_contain_text("虚构服务暂不可用")
            expect(reason).to_have_value("隔离验收模拟失败并保留输入")
            expect(reason).to_be_focused()
            assert commands.count("rejected mutation") == 1
            page.keyboard.press("Escape")
            expect(page.locator("#bulk-decline")).to_be_focused()

        scenarios.append(measure(page, cdp, "slow failed mutation, duplicate guard and retained input", repeat_rejected_submit))
        page.unroute("**/api/opportunities/batch-follow")
        page.route("**/api/opportunities?*", lambda route: route.abort("internetdisconnected"), times=1)

        page.reload()

        def retry_route():
            expect(page.locator("#main-slot [role=alert]")).to_contain_text("网络连接失败")
            page.get_by_role("button", name="重试", exact=True).click()
            expect(rows.first).to_be_visible()

        scenarios.append(measure(page, cdp, "offline read and retry", retry_route))

        def delayed_list(route):
            commands.append("slow list")
            page.wait_for_timeout(900)
            route.continue_()

        page.route("**/api/opportunities?*", delayed_list, times=1)

        def slow_list():
            page.locator('[data-tab="biddable"]').click()
            expect(page.locator("#route-loading")).to_be_visible()
            expect(page.locator("#route-loading")).to_be_hidden()
            expect(page.locator("#main-slot")).not_to_have_attribute("aria-busy", "true")

        scenarios.append(measure(page, cdp, "slow list, busy state and settled result", slow_list))
        page.go_back()
        expect(page.locator("#main-slot")).not_to_have_attribute("aria-busy", "true")
        expect(rows.first).to_be_visible()
        before_scroll = page.evaluate("window.scrollTo(0, 800); window.scrollY")
        page.evaluate("history.pushState(null, '', location.pathname + '?tab=biddable&onlyOpen=1'); dispatchEvent(new PopStateEvent('popstate'))")
        expect(page.locator("#main-slot")).not_to_have_attribute("aria-busy", "true")
        page.go_back()
        expect(page.locator("#main-slot")).not_to_have_attribute("aria-busy", "true")
        expect(rows.first).to_be_visible()
        assert abs(page.evaluate("window.scrollY") - before_scroll) < 3

        mobile = browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
            reduced_motion="reduce", storage_state=context.storage_state(),
        )
        mobile.route("**/*", lambda route: route.continue_() if urlsplit(route.request.url).netloc == origin.netloc else route.abort())
        phone = mobile.new_page()
        phone.on("pageerror", lambda error: errors.append(str(error)))
        phone.goto(args.base + "/opportunities?tab=all&onlyOpen=0")
        mobile_cdp = mobile.new_cdp_session(phone)
        mobile_cdp.send("Performance.enable")

        def reduced_touch():
            phone.locator("button[data-peek]").first.tap()
            close = phone.locator("#pk-close-2")
            expect(close).to_be_visible()
            assert close.bounding_box()["height"] >= 44
            assert phone.locator("[data-opportunity-peek]").evaluate("(element) => element.getAnimations({subtree:true}).length") == 0
            assert phone.locator(".center-modal").evaluate("(element) => element.getBoundingClientRect().right <= innerWidth")
            close.tap()
            expect(phone.locator("[data-opportunity-peek]")).to_have_count(0)

        scenarios.append(measure(phone, mobile_cdp, "390px touch and reduced motion", reduced_touch))
        assert not errors, errors
        assert all(command in commands for command in ("slow detail", "slow list", "rejected mutation")), commands
        report.update({"scenarios": scenarios, "pageErrors": errors, "controlledInterceptions": commands})
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        browser.close()


if __name__ == "__main__":
    main()
