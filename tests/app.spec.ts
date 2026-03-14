import { test, expect } from "@playwright/test";

test.describe("iHand App", () => {
  test("dev server responds", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("page has html structure", async ({ page }) => {
    await page.goto("/");

    const html = await page.content();
    expect(html).toContain("<html");
    expect(html).toContain("<body");
  });

  test("branding shows iHand, not Handy", async ({ page }) => {
    await page.goto("/");
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("Handy");
  });

  test("accent color is Royal Blue", async ({ page }) => {
    await page.goto("/");
    const bgUi = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--color-background-ui",
      ),
    );
    expect(bgUi.trim().toLowerCase()).toBe("#1606ea");
  });

  test("sidebar tabs are visible", async ({ page }) => {
    await page.goto("/");
    // The always-enabled sidebar tabs
    const expectedTabs = [
      "General",
      "Models",
      "Advanced",
      "History",
      "Transcribe",
      "About",
    ];
    for (const tab of expectedTabs) {
      await expect(page.getByText(tab, { exact: true })).toBeVisible();
    }
  });

  test("transcribe tab loads correctly", async ({ page }) => {
    await page.goto("/");
    // Click the Transcribe sidebar tab
    await page.getByText("Transcribe", { exact: true }).click();
    // Verify the transcribe UI is visible
    await expect(page.getByText("Transcribe File")).toBeVisible();
    await expect(page.getByText("Select WAV File")).toBeVisible();
  });
});
