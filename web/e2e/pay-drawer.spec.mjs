import { expect, test } from '@playwright/test';

import { demoMode, mockPayApis } from './mocks.mjs';

const NEAR = 10n ** 24n;
const reasons = (page) => page.getByRole('list', { name: 'Before you can continue' });

// Demo circle #0 (Balogun Market Traders) is running round 2; one round is 20 NEAR.
async function openDrawer(page, options) {
  await demoMode(page);
  const quotes = await mockPayApis(page, options);
  await page.goto('/circle/0?pay=1');
  await expect(page.getByRole('dialog', { name: 'Pay from any chain' })).toBeVisible();
  return quotes;
}

test('defaults to exactly one round, quoted with EXACT_OUTPUT, and says where the money lands', async ({ page }) => {
  const quotes = await openDrawer(page);
  await expect(page.getByRole('radio', { name: /1 round/ })).toBeChecked();
  await expect(page.getByText('NEAR lands in your NEAR mainnet account')).toBeVisible();
  await expect(page.getByText(/exactly 20 NEAR/)).toBeVisible();
  const first = quotes.find((q) => q.dry !== false);
  expect(first.swapType).toBe('EXACT_OUTPUT');
  expect(first.amount).toBe((20n * NEAR).toString());
  // Every cost is shown before paying.
  for (const label of ['You send', 'Least 1Click accepts', 'You receive', 'Fees and price spread', 'Time', 'If it is refunded']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/Live quote · refreshes in \d+s/)).toBeVisible();
  await expect(page.getByText(/lands for your circle/)).toHaveCount(0);
});

test('custom amount re-quotes for that exact amount', async ({ page }) => {
  const quotes = await openDrawer(page);
  await page.getByRole('radio', { name: /^Custom/ }).check();
  await page.getByLabel('Amount of NEAR').fill('0.5');
  await expect(page.getByText(/exactly 0\.5 NEAR/)).toBeVisible();
  expect(quotes.at(-1).amount).toBe((NEAR / 2n).toString());
});

test('the grey button says exactly what is missing, and enables once everything is valid', async ({ page }) => {
  await openDrawer(page);
  const button = page.getByRole('button', { name: 'Get deposit address' });
  await expect(button).toBeDisabled();
  await expect(reasons(page)).toContainText('Enter your NEAR mainnet account');
  await expect(reasons(page)).toContainText('Enter the address you are paying from');
  await expect(reasons(page)).toContainText('Tick the box');

  await page.getByLabel('Your NEAR mainnet account').fill('eric0xbt.testnet');
  await expect(reasons(page)).toContainText('That is a testnet account');
  await page.getByLabel('Your NEAR mainnet account').fill('eric0xbt.near');
  await expect(page.getByText('✓ Found on NEAR mainnet.')).toBeVisible();

  const refund = page.getByLabel(/Refund address/);
  await expect(refund).toHaveAttribute('placeholder', /^0x/);
  await refund.fill('TMHR8TC35MUoM1MYb4izP5bzLfyXaABgAn');
  await expect(reasons(page)).toContainText('not an EVM address');
  await refund.fill('0x8a55a5666d02f18e44c197c104601a32eac8dcc1');
  await page.getByRole('checkbox', { name: /not from an exchange/ }).check();
  await expect(reasons(page)).toHaveCount(0);
  await expect(button).toBeEnabled();
});

test('refund address placeholder and checks follow the chain', async ({ page }) => {
  await openDrawer(page);
  await page.getByRole('radio', { name: /^SOL/ }).check();
  const refund = page.getByLabel(/Refund address/);
  await expect(refund).toHaveAttribute('placeholder', /Solana/);
  await refund.fill('0x8a55a5666d02f18e44c197c104601a32eac8dcc1');
  await expect(reasons(page)).toContainText('not a Solana address');
  await refund.fill('HxM8VCKppf9fVMVBdj5rinWFSak9Mjrj7Byts98kfGJu');
  await expect(reasons(page)).not.toContainText('Solana');
});

test('a route below its minimum says so and suggests another route', async ({ page }) => {
  await openDrawer(page);
  await page.getByRole('radio', { name: /^USDT/ }).check();
  await expect(page.getByRole('alert').filter({ hasText: '$100 minimum' })).toBeVisible();
  await expect(reasons(page)).toContainText('Pick USDC on Base or SOL');
});

test('a mainnet account that does not exist blocks the payment', async ({ page }) => {
  await openDrawer(page, { accountExists: false });
  await page.getByLabel('Your NEAR mainnet account').fill('nobody-here.near');
  await expect(reasons(page)).toContainText('does not exist on NEAR mainnet');
});

test('committing asks for a fresh dry:false quote and shows the address, countdown and status', async ({ page }) => {
  const quotes = await openDrawer(page, { status: ['PENDING_DEPOSIT', 'PROCESSING', 'SUCCESS'] });
  await page.getByLabel('Your NEAR mainnet account').fill('eric0xbt.near');
  await page.getByLabel(/Refund address/).fill('0x8a55a5666d02f18e44c197c104601a32eac8dcc1');
  await page.getByRole('checkbox', { name: /not from an exchange/ }).check();
  await page.getByRole('button', { name: 'Get deposit address' }).click();
  await expect(page.getByText('0x1111111111111111111111111111111111111111')).toBeVisible();
  const committed = quotes.find((q) => q.dry === false);
  expect(committed.swapType).toBe('EXACT_OUTPUT');
  expect(committed.recipient).toBe('eric0xbt.near');
  await expect(page.getByText(/Send within \d+:\d\d/)).toBeVisible();
  await expect(page.getByText(/lands in eric0xbt\.near on NEAR mainnet/)).toBeVisible();
  await expect(page.getByText('Status: SUCCESS')).toBeVisible({ timeout: 20_000 });
});

test('remembers the payout account on this device', async ({ page }) => {
  await openDrawer(page);
  await page.getByLabel('Your NEAR mainnet account').fill('eric0xbt.near');
  await page.reload();
  await expect(page.getByLabel('Your NEAR mainnet account')).toHaveValue('eric0xbt.near');
});
