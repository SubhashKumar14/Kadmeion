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

test('approved vector identity is visible and named in both runtime themes', async ({ page }) => {
  await page.goto('/');
  const home = page.getByRole('link', { name: 'Kadmeion home', exact: true });
  const symbol = home.locator('.brand-symbol');
  const letters = home.locator('.brand-letters');
  await expect(home).toBeVisible();
  await expect(symbol).toHaveJSProperty('naturalWidth', 110);
  await expect(letters).toBeVisible();
  await expect(letters).toHaveCSS('mask-image', /kadmeion-wordmark\.svg/);
  expect((await page.request.get('/brand/kadmeion-wordmark.svg')).headers()['content-type']).toContain('image/svg+xml');
  await expect(letters).toHaveCSS('background-color', 'rgb(11, 26, 33)');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(letters).toHaveCSS('background-color', 'rgb(244, 243, 238)');
  await page.goto('/signin');
  await expect(page.getByRole('img', { name: 'Kadmeion', exact: true })).toBeVisible();
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
  await expect(page.getByRole('alert')).toContainText('not configured for this preview');
  await page.goto('/reset-password#access_token=abc123test&refresh_token=12345abcde&type=recovery');
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByRole('heading',{name:'Action not completed'})).toBeVisible();
});

test('direct recovery status never implies a verified session', async ({ page }) => {
  await page.goto('/auth/recovery-status');
  await expect(page.getByRole('heading', { name: 'Account recovery status' })).toBeVisible();
  await expect(page.getByText('Session verified', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open private workspace' })).toHaveCount(0);
  await expect(page.locator('.auth-page')).toHaveAttribute('data-panel', 'left');
});

test('auth recovery and registration remain disabled until actual sender proof', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('link',{name:/Forgot password/}).click();
  await expect(page.getByRole('heading',{name:'Reset your password.'})).toBeVisible();
  const recoveryButton = page.getByRole('button',{name:/Request recovery link/});
  await expect(recoveryButton).toBeDisabled();
  const recoveryBounds = await recoveryButton.boundingBox();
  const recoveryNotice = await page.getByText(/Email recovery is not available/).boundingBox();
  expect(recoveryBounds).not.toBeNull();
  expect(recoveryNotice).not.toBeNull();
  expect(recoveryNotice!.y).toBeGreaterThanOrEqual(recoveryBounds!.y + recoveryBounds!.height);
  await page.goto('/signup');
  await expect(page.getByRole('button',{name:/Create account/})).toBeDisabled();
  await expect(page.getByText(/until sender delivery is verified/)).toBeVisible();
  const createButton=await page.getByRole('button',{name:/Create account/}).boundingBox();
  const deliveryNotice=await page.getByText(/until sender delivery is verified/).boundingBox();
  expect(createButton).not.toBeNull();
  expect(deliveryNotice).not.toBeNull();
  expect(deliveryNotice!.y).toBeGreaterThanOrEqual(createButton!.y+createButton!.height);
});

test('private workspace routes deny unverified access without exposing account data', async ({ page }) => {
  for (const route of ['/app', '/app/onboarding', '/app/projects', '/app/projects/11111111-1111-4111-8111-111111111111']) {
    await page.goto(route);
    await expect(page.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Owner authentication is not configured');
    await expect(page.getByRole('link',{name:/Go to sign in/})).toHaveAttribute('href','/signin');
    await expect(page.getByRole('heading',{name:/Shape your portfolio/})).toHaveCount(0);
    await expect(page.getByRole('group',{name:'Choose your next step'})).toHaveCount(0);
    await page.getByRole('button',{name:'Retry verification'}).focus();
    await expect(page.getByRole('button',{name:'Retry verification'})).toBeFocused();
  }
});

test('private route denied on phone does not produce horizontal overflow', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/app/onboarding');
  await expect(page.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
  const dimensions=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport+2);
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

test('SYS-01 fallback does not disclose private records and responds to offline changes', async ({ page }) => {
  await page.goto('/private-or-expired-example');
  await expect(page.getByRole('heading', { name: 'This page is unavailable.' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('do not confirm whether a private record exists');
  await expect(page.getByRole('navigation', {name: 'Workspace navigation'})).toHaveCount(0);
  const retry = page.getByRole('button', {name: 'Retry this address'});
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => false});
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.getByRole('heading', {name: 'Your browser reports no connection.'})).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => true});
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByRole('heading', {name: 'This page is unavailable.'})).toBeVisible();
  await page.getByRole('link', {name: 'Return to home'}).click();
  await expect(page).toHaveURL('/');
});
