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

test('unsupported private route fails visibly rather than rendering a fake auth form', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('heading',{name:/Not available in this frontend preview/})).toBeVisible();
  await expect(page.getByText(/no sign-in or publication was attempted/)).toBeVisible();
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
