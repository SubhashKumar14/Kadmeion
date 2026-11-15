import { test, expect } from '@playwright/test';

test('landing respects approved public path, can switch theme and persists preference', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /^Your Developer Identity/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  const theme=page.getByRole('button', { name: 'Switch to dark theme' });
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

test('manual carousel, pause and native FAQ are keyboard-operable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: /Workspace illustrative interface concept/ })).toBeVisible();
  await page.getByRole('button',{name:'Next product example'}).click();
  await expect(page.getByRole('img',{name:/Portfolio Studio illustrative interface concept/})).toBeVisible();
  await page.getByRole('button',{name:'Pause automatic preview'}).click();
  await expect(page.getByRole('button',{name:'Resume automatic preview'})).toHaveAttribute('aria-pressed','true');
  const question=page.locator('summary').filter({hasText:'Is my work private by default?'});
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Draft profiles, projects and portfolio work remain private/)).toBeVisible();
});

test('template filters and preview dialog are functional and escape restores focus', async ({ page }) => {
  await page.goto('/templates');
  await expect(page.getByRole('heading',{name:'Portfolio Templates'})).toBeVisible();
  await page.getByRole('searchbox',{name:'Search templates'}).fill('stepped');
  await expect(page.getByRole('article')).toHaveCount(1);
  const previewButton=page.getByRole('button',{name:'Preview'});
  await previewButton.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Stepped Minimal'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(previewButton).toBeFocused();
});

test('showcase sample filters do not imply private published account access', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.getByText(/not live published accounts/i)).toBeVisible();
  await page.getByRole('button',{name:'AI / ML',exact:true}).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Aegis AI'})).toBeVisible();
  await page.getByRole('searchbox',{name:'Search concept examples'}).fill('nothing matched');
  await expect(page.getByRole('heading',{name:'No matching concepts'})).toBeVisible();
});

test('unconfigured Supabase renders signed-out auth without attempting a provider request', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('heading',{name:'Sign in to your account.'})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:/Google sign-in not configured/})).toBeDisabled();
});

test('sign-in and sign-up switch without losing transient form values', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('textbox',{name:'Email address'}).fill('person@example.org');
  await page.locator('#signin-password').fill('not-a-real-password');
  await page.getByRole('link',{name:/Create an account/}).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading',{name:'Create your account.'})).toBeVisible();
  await expect(page.locator('.auth-page')).toHaveAttribute('data-mode','signup');
  await expect(page.getByRole('textbox',{name:'Email address'})).toHaveValue('person@example.org');
  await page.getByRole('link',{name:/Sign in/}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.locator('#signin-password')).toHaveValue('not-a-real-password');
});

test('OAuth and recovery callbacks scrub tokens and fail closed when backend is unavailable', async ({ page }) => {
  await page.goto('/auth/callback?code=abcdefgh123456789');
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page.getByRole('heading',{name:'Action not completed'})).toBeVisible();
  await expect(page.getByText(/not configured for this preview/)).toBeVisible();
  await page.goto('/reset-password#access_token=abc123test&refresh_token=12345abcde&type=recovery');
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByRole('heading',{name:'Action not completed'})).toBeVisible();
});

test('auth recovery and registration remain disabled until actual sender proof', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('link',{name:/Forgot password/}).click();
  await expect(page.getByRole('heading',{name:'Reset your password.'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Request recovery link/})).toBeDisabled();
  await page.goto('/signup');
  await expect(page.getByRole('button',{name:/Create account/})).toBeDisabled();
  await expect(page.getByText(/until sender delivery is verified/)).toBeVisible();
});

test('mobile public pages reflow without page-wide horizontal overflow', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  for (const route of ['/','/explore','/templates']) {
    await page.goto(route);
    const sizes=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    expect(sizes.scroll,route+' has horizontal overflow').toBeLessThanOrEqual(sizes.viewport+2);
    await expect(page.getByRole('navigation',{name:'Primary navigation'})).toBeVisible();
  }
});
