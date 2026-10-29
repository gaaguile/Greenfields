// Renders JavaScript-built pages with Playwright. Playwright is an optional dependency, loaded only when a
// source is marked `render`.

type PlaywrightModule = typeof import("playwright");

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
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage({ userAgent });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}
