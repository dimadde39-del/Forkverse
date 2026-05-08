import { expect, test } from '@playwright/test';

const BASE_URL = process.env.MONTERUN_URL ?? 'https://monterun.vercel.app/';
const SCENARIO =
  'cash $8,000,000, monthly burn $950,000, monthly income $700,000, income starts in 3 months, horizon 18 months.';

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const PARSE_RESPONSE_TIMEOUT_MS = 60_000;
const RESULT_RENDER_TIMEOUT_MS = 15_000;
const WHAT_IF_TIMEOUT_MS = 15_000;
const SHARE_PAGE_TIMEOUT_MS = 20_000;

test('MonteRun live happy path, what-if, and share flow', async ({ page }) => {
  test.setTimeout(105_000);

  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleMessages.push(`pageerror: ${error.message}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: PAGE_LOAD_TIMEOUT_MS });
  await expect(
    page.getByRole('heading', {
      name: /Cash runway intelligence with delayed-income modeling/i,
    }),
  ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT_MS });

  const scenarioInput = page.getByRole('textbox', { name: /Describe your financial scenario/i });
  await scenarioInput.click();
  await scenarioInput.pressSequentially(SCENARIO);
  await expect(scenarioInput).toHaveValue(SCENARIO);

  const parseResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/parse'),
    { timeout: PARSE_RESPONSE_TIMEOUT_MS },
  );
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expect(page.getByText(/READING|SIMULATED/)).toBeVisible({ timeout: 5_000 });
  const parseResponse = await parseResponsePromise;
  expect(parseResponse.ok(), `/api/parse returned ${parseResponse.status()}`).toBe(true);

  await expect(page.getByText('SIMULATED')).toBeVisible({ timeout: RESULT_RENDER_TIMEOUT_MS });
  await expect(page.getByText('PLAN CAPTURED | CAPITAL 8000000')).toBeVisible();
  await expect(page.getByText(/SIMULATION COMPLETE \| SURVIVAL/i)).toBeVisible();
  await expect(page.getByText('1000 sims')).toBeVisible();
  await expect(page.getByRole('button', { name: /\[ Share Reality Check \]/ })).toBeVisible();

  const parseTiming = await page.evaluate(() => {
    const parseRequest = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/api/parse'));

    return parseRequest ? Math.round(parseRequest.duration) : null;
  });

  await test.step('apply stress assumptions', async () => {
    await page.getByRole('button', { name: 'Apply stress' }).first().click();
    await expect(page.getByRole('button', { name: 'Applied' }).first()).toBeDisabled({
      timeout: WHAT_IF_TIMEOUT_MS,
    });

    await page.getByRole('button', { name: 'Apply stress' }).click();
    await expect(page.getByText('WHAT-IF', { exact: true })).toBeVisible({ timeout: WHAT_IF_TIMEOUT_MS });
    await expect(page.getByRole('textbox', { name: /Burn multiplier precise value/i })).toHaveValue('1.2', {
      timeout: WHAT_IF_TIMEOUT_MS,
    });
    await expect(page).toHaveURL(/burn_multiplier=1\.2/, { timeout: WHAT_IF_TIMEOUT_MS });
  });

  await test.step('apply an escape route', async () => {
    const burnReductionRoute = page.getByRole('button', {
      name: /Burn\s+-\$\s*95,000\s+->\s+\$\s*855,000/i,
    });

    await burnReductionRoute.click();
    await expect(page.getByRole('textbox', { name: /Monthly Burn precise value/i })).toHaveValue('855000', {
      timeout: WHAT_IF_TIMEOUT_MS,
    });
    await expect(page.getByLabel('Escape Routes').getByRole('button', { name: /Applied/i })).toBeDisabled();
  });

  await test.step('verify share page and OG image', async () => {
    const shareUrl = await page.getByRole('link', { name: 'Open share page' }).getAttribute('href');
    expect(shareUrl).toBeTruthy();

    await page.goto(new URL(shareUrl!, BASE_URL).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: SHARE_PAGE_TIMEOUT_MS,
    });
    await expect(page.getByText('MonteRun share page')).toBeVisible({ timeout: SHARE_PAGE_TIMEOUT_MS });
    await expect(page.getByText('Runway', { exact: true })).toBeVisible();
    await expect(page.getByText('Survival 12m', { exact: true })).toBeVisible();

    const verdictImage = page.locator('img[alt^="MonteRun verdict"]');
    await expect(verdictImage).toBeVisible();
    await expect
      .poll(
        async () =>
          verdictImage.evaluate((img) => {
            const image = img as HTMLImageElement;
            return {
              complete: image.complete,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
            };
          }),
        { timeout: SHARE_PAGE_TIMEOUT_MS },
      )
      .toEqual({
        complete: true,
        naturalWidth: 1200,
        naturalHeight: 630,
      });
  });

  await test.info().attach('observed-parse-duration-ms', {
    body: String(parseTiming ?? 'not captured'),
    contentType: 'text/plain',
  });

  expect(consoleMessages.filter((message) => !message.includes('favicon.ico'))).toEqual([]);
});
