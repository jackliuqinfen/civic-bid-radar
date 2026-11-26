"""Exercise race-free tab navigation against a local fixture instance."""

import asyncio
import json
import os
from urllib.parse import parse_qs, urlsplit

from playwright.async_api import async_playwright, expect


async def main():
    origin = "http://127.0.0.1:34873"
    reports = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel="chrome")
        for motion in ("no-preference", "reduce"):
            context = await browser.new_context(reduced_motion=motion, viewport={"width": 1440, "height": 900})
            page = await context.new_page()
            errors = []
            requests = []
            finished = []
            payment_requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))

            async def local_only(route):
                url = urlsplit(route.request.url)
                if url.netloc != "127.0.0.1:34873":
                    await route.abort()
                    return
                if url.path == "/api/workbench/home":
                    await asyncio.sleep(1.1)
                    await route.continue_()
                    return
                if url.path == "/api/finance":
                    response = await route.fetch()
                    payload = await response.json()
                    payload["payTasks"] = [{"id": "qa-tab-task", "status": "pending", "amount_fen": 100, "noticeTitle": "虚构付款任务"}]
                    await route.fulfill(response=response, json=payload)
                    return
                if url.path.startswith("/api/finance/pay-tasks/"):
                    payment_requests.append(url.path)
                    await route.abort()
                    return
                if url.path != "/api/opportunities":
                    await route.continue_()
                    return
                tab = parse_qs(url.query).get("tab", [""])[0]
                if tab == "amendments":
                    requests.append(tab)
                    await asyncio.sleep(1.2)
                elif tab == "all":
                    requests.append(tab)
                    await asyncio.sleep(0.65)
                await route.continue_()
                finished.append(tab)

            await context.route("**/*", local_only)
            await page.goto(origin + "/opportunities")
            await page.locator("#lg-user").fill(os.environ["RADAR_QA_USERNAME"])
            await page.locator("#lg-pass").fill(os.environ["RADAR_QA_PASSWORD"])
            await page.locator("#btn-login-submit").click()
            await expect(page.locator('[data-tab="biddable"]')).to_have_attribute("aria-pressed", "true")
            await page.locator('[data-tab="biddable"]').click()
            assert (await page.evaluate("location.search")) == ""
            await page.evaluate("""() => {
              const stats = { frames: 0, missing: 0, old: 0, settled: 0 };
              const initial = document.querySelector('#main-slot');
              const sample = () => {
                stats.frames++;
                const slot = document.querySelector('#main-slot');
                if (!slot?.querySelector('[data-tab]') || !slot.getClientRects().length) stats.missing++;
                if (initial === slot) stats.old++;
                if (slot?.querySelector('[data-tab=all].active')) stats.settled++;
                window.probeFrame = requestAnimationFrame(sample);
              };
              window.probeFrame = requestAnimationFrame(sample);
              window.tabFrameStats = stats;
            }""")
            await page.locator('[data-tab="amendments"]').click()
            await expect(page.locator("#main-slot")).to_have_attribute("aria-busy", "true")
            await expect(page.locator('[data-tab="biddable"]')).to_have_attribute("aria-pressed", "true")
            old_row = page.locator(".row-chk").first
            await old_row.focus()
            await page.keyboard.press("Space")
            await expect(old_row).not_to_be_checked()
            await page.locator('[data-tab="all"]').click()
            await page.locator('[data-tab="all"]').click()
            await expect(page.locator("#route-loading")).to_be_visible()
            await expect(page.locator('[data-tab="all"]')).to_have_attribute("aria-pressed", "true")
            await expect(page.locator('[data-tab="all"]')).to_be_focused()
            await expect(page.locator("#route-loading")).to_be_hidden()
            await page.wait_for_timeout(850)
            await expect(page.locator('[data-tab="all"]')).to_have_attribute("aria-pressed", "true")
            assert requests == ["amendments", "all"], requests
            completion_order = finished[-2:]
            assert completion_order == ["all", "amendments"], finished
            stats = await page.evaluate("cancelAnimationFrame(window.probeFrame); window.tabFrameStats")
            assert stats["old"] > 0 and stats["settled"] > 0 and stats["missing"] == 0, stats
            assert not errors, errors
            await page.goto(origin)
            await expect(page.locator("#main-slot")).to_have_attribute("data-first-load", "")
            await page.locator('.nav-item[data-go="/opportunities"]').click()
            await expect(page.locator('[data-tab="biddable"]')).to_have_attribute("aria-pressed", "true")
            await page.wait_for_timeout(1200)
            await expect(page.locator('[data-tab="biddable"]')).to_have_attribute("aria-pressed", "true")
            await page.locator('.nav-item[data-go="/finance"]').click()
            payment = page.locator('[data-confirm-pay="qa-tab-task"]')
            await payment.click()
            await expect(page.locator("#confirm-pay-form")).to_be_visible()
            stale_form = await page.locator("#confirm-pay-form").element_handle()
            await page.go_back()
            await expect(page.locator("#confirm-pay-form")).to_have_count(0)
            await expect(page.locator('[data-tab="biddable"]')).to_have_attribute("aria-pressed", "true")
            await stale_form.dispatch_event("submit")
            await page.go_forward()
            await expect(payment).to_be_visible()
            await expect(page.locator("#confirm-pay-form")).to_have_count(0)
            assert not payment_requests, payment_requests
            assert not errors, errors
            reports.append({
                "reducedMotion": motion, **stats, "requestOrder": requests,
                "completionOrder": completion_order, "firstLoadRacePassed": True,
                "paymentRequestsAfterHistoryNavigation": len(payment_requests),
            })
            await context.close()
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
