import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet";

/**
 * onboarding_desktop_and_mobile_360px (master prompt 1.6): redeem invite →
 * sign in → accept versioned disclosure → participant status → sign out,
 * against the real service. Refresh must restore state; nothing may overflow
 * horizontally at 360 px.
 */
test("onboarding_desktop_and_mobile_360px", async ({ page }, info) => {
  const codes = (process.env.E2E_INVITE_CODES ?? "").split(",");
  const code = codes[info.project.name === "desktop" ? 0 : 1];
  expect(code, "invite code for this project").toBeTruthy();

  // Any uncaught error or console.error in the browser fails the journey.
  const browserErrors: string[] = [];
  page.on("pageerror", (err) => browserErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location().url;
    // Expected refusals from our auth API (signed-out session check, refresh,
    // the deliberately wrong invite) and third-party RPC throttling are logged
    // by the browser as failed loads. Everything else is a real error.
    if (/Failed to load resource/.test(msg.text())) {
      if (/\/api\/auth\//.test(url) && /status of 40[13]/.test(msg.text())) return;
      if (!url.startsWith("http://localhost")) return;
    }
    browserErrors.push(`console.error: ${msg.text()} @ ${url}`);
  });

  const address = await installTestWallet(page);
  await page.goto("/onboarding");

  // Honest environment banner.
  await expect(page.getByTestId("network-banner")).toHaveText("TESTNET · NO REAL VALUE · NO INDEPENDENT REVIEW");

  // 1 — connect.
  await expect(page.getByTestId("step-2-state")).toHaveText("locked");
  await page.getByRole("button", { name: /injected|browser wallet|ethereum/i }).first().click();
  await expect(page.getByTestId("step-1-state")).toHaveText("done");

  // 2 — SIWE sign-in (the test wallet signs in the Node process).
  await page.getByRole("button", { name: "Sign in with wallet" }).click();
  await expect(page.getByTestId("signed-in-as")).toContainText(address.slice(0, 6));
  await expect(page.getByTestId("step-2-state")).toHaveText("done");

  // 3 — a wrong code is refused with a plain message; the real one binds.
  const input = page.getByLabel("Invitation code");
  await input.fill("not-a-real-invitation");
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "invalid, already used, or expired" })).toBeVisible();
  await input.fill(code!);
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByTestId("step-3-state")).toHaveText("done");

  // 4 — read and accept the versioned disclosure.
  await expect(page.getByTestId("disclosure-text")).toContainText("NO REAL VALUE");
  const accept = page.getByRole("button", { name: "Accept" });
  await expect(accept).toBeDisabled();
  await page.getByLabel("I have read this version of the disclosure.").check();
  await accept.click();
  await expect(page.getByTestId("step-4-state")).toHaveText("done");

  // 5 — backend onboarding complete; on-chain admission stays separate and unavailable.
  await expect(page.getByTestId("backend-onboarding")).toHaveText("complete");
  await expect(page.getByTestId("onchain-admission")).toContainText("not available");
  await expect(page.getByTestId("onchain-admission")).not.toContainText(/admitted|eligible/i);
  await expect(page.getByTestId("step-5-state")).toHaveText("done");

  // Refresh restores state from the server (session cookie + eligibility).
  await page.reload();
  await expect(page.getByTestId("step-2-state")).toHaveText("done");
  await expect(page.getByTestId("step-4-state")).toHaveText("done");
  await expect(page.getByTestId("backend-onboarding")).toHaveText("complete");

  // No horizontal overflow at any width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.screenshot({ path: info.outputPath(`onboarding-${info.project.name}.png`), fullPage: true });

  // Sign out ends the session; a reload stays signed out.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with wallet" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with wallet" })).toBeVisible();

  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});
