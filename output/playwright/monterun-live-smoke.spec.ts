import { expect, test } from '@playwright/test';

const BASE_URL = process.env.MONTERUN_URL ?? 'https://monterun.vercel.app/';
const SCENARIO =
  'cash $20,000, monthly burn $8,000, monthly income $2,000, income starts immediately, horizon 18 months.';
const BASELINE_STORAGE_KEY = 'monterun_baseline_months';
const TARGET_MONTHLY_BURN = '4000';

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const PARSE_RESPONSE_TIMEOUT_MS = 60_000;
const RESULT_RENDER_TIMEOUT_MS = 15_000;
const WHAT_IF_TIMEOUT_MS = 15_000;

test('MonteRun live happy path, what-if, and share flow', async ({ page }) => {
  test.setTimeout(90_000);

  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleMessages.push(`pageerror: ${error.message}`);
  });

  await page.addInitScript((storageKey) => {
    window.localStorage.removeItem(storageKey);
  }, BASELINE_STORAGE_KEY);

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
  await expect(page.getByText('PLAN CAPTURED | CAPITAL 20000')).toBeVisible();
  await expect(page.getByText(/SIMULATION COMPLETE \| SURVIVAL/i)).toBeVisible();
  await expect(page.getByText('1000 sims')).toBeVisible();
  await expect(page.getByRole('button', { name: /\[ Share Reality Check \]/ })).toHaveCount(0);
  await expect(page.getByLabel('Delta Share Card')).toHaveCount(0);

  const baselineMonths = await page.evaluate((storageKey) => {
    return window.localStorage.getItem(storageKey);
  }, BASELINE_STORAGE_KEY);
  expect(baselineMonths).toBeTruthy();
  expect(Number.isFinite(Number(baselineMonths))).toBe(true);
  expect(Number(baselineMonths)).toBeGreaterThan(0);

  const parseTiming = await page.evaluate(() => {
    const parseRequest = performance
      .getEntriesByType('resource')
      .find((entry) => entry.name.includes('/api/parse'));

    return parseRequest ? Math.round(parseRequest.duration) : null;
  });

  await test.step('apply burn improvement and verify X intent', async () => {
    const monthlyBurnInput = page.getByRole('textbox', { name: /Monthly Burn precise value/i });
    await monthlyBurnInput.fill(TARGET_MONTHLY_BURN);
    await expect(monthlyBurnInput).toHaveValue(TARGET_MONTHLY_BURN, {
      timeout: WHAT_IF_TIMEOUT_MS,
    });
    await expect(page.getByText('WHAT-IF', { exact: true })).toBeVisible({ timeout: WHAT_IF_TIMEOUT_MS });

    const deltaCard = page.getByLabel('Delta Share Card');
    await expect(deltaCard).toBeVisible({ timeout: WHAT_IF_TIMEOUT_MS });
    const deltaCopy = await deltaCard
      .getByText(/You bought yourself \+\d+\.\d months of survival time\./)
      .textContent();
    const deltaMonths = deltaCopy?.match(/\+([0-9]+\.[0-9]) months/)?.[1];
    expect(deltaMonths).toBeTruthy();

    const shareHref = await deltaCard.getByRole('link', { name: 'Share to X' }).getAttribute('href');
    expect(shareHref).toBeTruthy();

    const intentUrl = new URL(shareHref!);
    expect(`${intentUrl.origin}${intentUrl.pathname}`).toBe('https://twitter.com/intent/tweet');
    expect(intentUrl.searchParams.get('text')).toBe(
      `I just crash-tested my freelance budget. By cutting the fat, I bought myself +${deltaMonths} months of survival time.\n\nCrash-test your own money here: https://monterun.vercel.app`,
    );

    const baselineAfterWhatIf = await page.evaluate((storageKey) => {
      return window.localStorage.getItem(storageKey);
    }, BASELINE_STORAGE_KEY);
    expect(baselineAfterWhatIf).toBe(baselineMonths);
  });

  await test.info().attach('observed-parse-duration-ms', {
    body: String(parseTiming ?? 'not captured'),
    contentType: 'text/plain',
  });

  expect(consoleMessages.filter((message) => !message.includes('favicon.ico'))).toEqual([]);
});
