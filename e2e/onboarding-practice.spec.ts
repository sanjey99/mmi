import { expect, test } from '@playwright/test';

const enabled = Boolean(
  process.env.E2E_BASE_URL
  && process.env.E2E_STUDENT_EMAIL
  && process.env.E2E_STUDENT_PASSWORD,
);

test.skip(!enabled, 'Requires an isolated web deployment and E2E student credentials.');

test('onboarding guard leads into practice, feedback, and progress', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(process.env.E2E_STUDENT_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_STUDENT_PASSWORD!);
  await page.getByText('Log In', { exact: true }).click();

  await expect(page.getByText('Welcome to Interview Station')).toBeVisible();
  await page.getByText('UCL', { exact: true }).click();
  await page.getByText("Let's Start →", { exact: true }).click();
  await expect(page.getByText('Practice', { exact: true }).first()).toBeVisible();

  await page.getByText('Start Session →', { exact: true }).click();
  await expect(page.getByText('YOUR ANSWER', { exact: true })).toBeVisible();
  await page.getByPlaceholder(/Begin your response here/i).fill(
    'I would listen carefully, clarify the patient’s concerns, and balance autonomy with beneficence while seeking senior support.',
  );
  await page.getByText('Submit Answer →', { exact: true }).click();

  await expect(page.getByText('AI FEEDBACK', { exact: true })).toBeVisible();
  await page.getByText('Progress', { exact: true }).click();
  await expect(page.getByText('Recent Sessions', { exact: true })).toBeVisible();
});
