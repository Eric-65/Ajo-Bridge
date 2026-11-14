#!/usr/bin/env node
/**
 * Opens the hosted site in a real browser and checks it is in LIVE mode, reading
 * circles from the testnet contract (list_circles and get_circle from the page).
 * Read-only: nothing is signed. Used by .github/workflows/live-check.yml.
 *
 *   SITE=https://ajo-bridge.vercel.app node scripts/check-live-site.mjs
 */
import { chromium } from 'playwright';

const SITE = (process.env.SITE || 'https://ajo-bridge.vercel.app').replace(/\/$/, '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, label, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed += 1; };

await page.goto(`${SITE}/circles`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
const live = await page.locator('.banner--live').count();
check(live === 1, 'opens in LIVE mode', live ? await page.locator('.banner--live').innerText() : await page.locator('.banner').first().innerText().catch(() => 'no banner'));
const titles = await page.locator('main article .title').allInnerTexts();
check(titles.length > 0, 'circles listed from list_circles', titles.join(' | ') || 'none');

if (titles.length) {
  await page.locator('main article .cta').first().click();
  await page.waitForTimeout(4000);
  const heading = await page.locator('main h1').first().innerText().catch(() => '');
  const slots = await page.locator('.ring svg').getAttribute('aria-label').catch(() => '');
  check(Boolean(heading), 'circle page loads from get_circle', `${heading} · ${(slots || '').slice(0, 120)}`);
}
await page.goto(`${SITE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
const stats = await page.locator('.stats .stat__label').count();
check(stats >= 4 || (await page.getByText('No circles yet').count()) > 0, 'landing shows live totals');
check(errors.length === 0, 'no page errors', errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed.` : '\nThe hosted site reads the testnet contract in a real browser.');
process.exitCode = failed ? 1 : 0;
