import { expect, test } from '@playwright/test';

import { demoMode } from './mocks.mjs';

// Demo circle #1 (Lagos to London Family) is filling; the demo persona is you.demo.
test('taking a slot defaults to the full collateral; 10% is a second, explained option', async ({ page }) => {
  await demoMode(page);
  await page.goto('/circle/1');
  await page.getByRole('button', { name: /Take slot 2/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Take slot 2' });
  await expect(drawer.getByRole('radio', { name: /Lock the full collateral/ })).toBeChecked();
  await expect(drawer.getByRole('radio', { name: /Lock 10% now/ })).toBeHidden();
  await drawer.getByText("Can't lock it all now?").click();
  await expect(drawer.getByText(/cannot start/)).toBeVisible();
});

test('a member who locked only 10% can top up, or leave with a full refund', async ({ page }) => {
  await demoMode(page);
  await page.goto('/circle/1');
  await page.getByRole('button', { name: /Take slot 2/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Take slot 2' });
  await drawer.getByText("Can't lock it all now?").click();
  await drawer.getByRole('radio', { name: /Lock 10% now/ }).check();
  await drawer.getByRole('button', { name: /^Lock/ }).click();

  const card = page.locator('.card', { hasText: 'Your slot' });
  await expect(card.getByText('Not fully locked')).toBeVisible();
  await expect(card.getByRole('button', { name: /Top up my collateral/ })).toBeVisible();
  await expect(card.getByText(/leaving is free/)).toBeVisible();

  await card.getByRole('button', { name: /Top up my collateral/ }).click();
  await expect(card.getByText('Ready')).toBeVisible();

  await card.getByRole('button', { name: 'Leave and get my deposit back' }).click();
  await expect(page.locator('.card', { hasText: 'Your slot' })).toHaveCount(0);
});

test('circle cards say what a circle is waiting for', async ({ page }) => {
  await demoMode(page);
  await page.goto('/circles');
  await expect(page.getByText(/slots? open/).first()).toBeVisible();
});

test('counters show the real number even before they animate', async ({ page }) => {
  await demoMode(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const circles = page.locator('.stat').filter({ has: page.locator('.stat__label', { hasText: /^Circles$/ }) }).locator('.numeral');
  await expect(circles).not.toHaveText('0');
});

test('the hero demo button opens the demo circle', async ({ page }) => {
  await page.route(/rpc\.testnet\.near\.org|test\.rpc\.fastnear\.com/, (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo circle' }).click();
  await expect(page).toHaveURL(/\/circle\/0$/);
  await expect(page.getByRole('heading', { name: 'Balogun Market Traders' })).toBeVisible();
});
