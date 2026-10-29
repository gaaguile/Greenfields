// Renders JavaScript-built pages with Playwright. Playwright is an optional dependency, loaded only when a
// source is marked `render`.

import { withTimeout } from "../timeout.ts";

type PlaywrightModule = typeof import("playwright");

const RENDER_TIMEOUT_MS = 120_000;
const INSTALL_HINT = "playwright is not installed: npm i -D playwright && npx playwright install chromium";

export async function renderPage(
  url: string,
  userAgent: string,
  importer: () => Promise<PlaywrightModule> = () => import("playwright"),
): Promise<string> {
  let playwright: PlaywrightModule;
  try {
    playwright = await importer();
  } catch {
    throw new Error(INSTALL_HINT);
  }
  const browser = await withTimeout(playwright.chromium.launch(), RENDER_TIMEOUT_MS, "browser start");
  try {
    const load = async () => {
      const page = await browser.newPage({ userAgent });
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
      return page.content();
    };
    return await withTimeout(load(), RENDER_TIMEOUT_MS, `rendering ${url}`);
  } finally {
    await browser.close().catch(() => {});
  }
}
