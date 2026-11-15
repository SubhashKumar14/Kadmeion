import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:54321';

async function localUser(label: string) {
  const serviceKey = process.env.KADMEION_TEST_SERVICE_ROLE_KEY;
  if (!serviceKey || process.env.VITE_SUPABASE_URL !== origin)
    throw new Error('The owner browser fixture requires isolated local Supabase.');
  const email = 'ci-' + randomUUID() + '@testing.invalid';
  const password = 'LocalFixture!' + randomUUID();
  const response = await fetch(origin + '/auth/v1/admin/users', {
    method: 'POST',
    headers: {apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json'},
    body: JSON.stringify({email, password, email_confirm: true, user_metadata: {display_name: label}}),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error('Local GoTrue fixture creation failed with HTTP ' + response.status);
  return {email, password};
}

async function signIn(page: Page, user: {email: string; password: string}) {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(user.email);
  await page.locator('#signin-password').fill(user.password);
  const requestResults: string[] = [];
  function onResponse(response: import('@playwright/test').Response) {
    const url = new URL(response.url());
    if (url.origin === origin) requestResults.push(url.pathname + ' HTTP ' + response.status());
  }
  function onRequestFailed(request: import('@playwright/test').Request) {
    const url = new URL(request.url());
    if (url.origin === origin) requestResults.push(url.pathname + ' failed: ' + request.failure()?.errorText);
  }
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  try {
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Session verified'})).toBeVisible();
  } catch {
    const mode = await page.locator('.auth-page').getAttribute('data-mode').catch(() => 'unavailable');
    const alert = (await page.getByRole('alert').allTextContents()).join(' ');
    const reason = /password is required|enter a valid email|incorrect credentials or sign-in unavailable|unable to verify the authenticated session/i
      .exec(alert)?.[0] ?? (alert ? 'unclassified alert' : 'no alert');
    throw new Error('Local browser sign-in did not complete. Mode=' + mode +
      ', reason=' + reason + ', requests=' + requestResults.join(', '));
  } finally {
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  }
}

test('real owner onboarding and project revision are private across browser sessions', async ({page, browser}, testInfo) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1', 'Requires the isolated Supabase CI job.');
  test.setTimeout(90_000);
  const [owner, outsider] = await Promise.all([localUser('CI Portfolio Owner'), localUser('CI Other Owner')]);
  const captureDir = process.env.KADMEION_BROWSER_CAPTURE_DIR;
  async function capture(name: string) {
    if (!captureDir) return;
    await mkdir(captureDir, {recursive: true});
    await page.screenshot({path: captureDir + '/' + name + '.png', animations: 'disabled'});
  }

  await page.setViewportSize({width: 1534, height: 960});
  await signIn(page, owner);
  await page.getByRole('link', {name: 'Open private workspace'}).click();
  await expect(page.getByRole('heading', {name: /Make room for/})).toBeVisible();
  await capture('11_WORKSPACE_BROWSER');

  await page.goto('/app/profile');
  await expect(page.getByLabel('Display name', {exact: true})).toBeVisible();
  const stale = await page.context().newPage();
  try {
    await stale.goto('/app/profile');
    await expect(stale.getByLabel('Display name', {exact: true})).toBeVisible();
    await page.getByLabel('Headline', {exact: true}).fill('Private developer draft');
    await page.getByLabel('Add skill', {exact: true}).fill('TypeScript');
    await page.getByRole('button', {name: 'Add skill', exact: true}).click();
    await page.getByRole('button', {name: 'Save profile draft'}).click();
    await expect(page.getByRole('status')).toHaveText('Private profile draft saved.');
    await stale.getByLabel('Headline', {exact: true}).fill('Stale overwritten headline');
    await stale.getByRole('button', {name: 'Save profile draft'}).click();
    await expect(stale.getByRole('alert')).toContainText('changed in another session');
    await expect(stale.getByLabel('Headline', {exact: true})).toHaveValue('Stale overwritten headline');
    await page.reload();
    await expect(page.getByLabel('Headline', {exact: true})).toHaveValue('Private developer draft');
    await expect(page.getByRole('button', {name: 'Remove TypeScript'})).toBeVisible();
    await capture('12_PROFILE_BROWSER');
  } finally {
    await stale.close();
  }

  await page.goto('/app/onboarding');
  await expect(page.getByRole('group', {name: 'Choose your next step'})).toBeVisible();
  await capture('10_ONBOARDING_BROWSER');
  await page.getByRole('button', {name: 'Skip selected step'}).click();
  await expect(page.getByRole('status')).toContainText('saved as skipped');
  await page.reload();
  await expect(page.getByText('Skipped in your private account')).toBeVisible();

  await page.goto('/app/projects');
  await expect(page.getByRole('heading', {name: 'Your first project belongs here.'})).toBeVisible();
  await capture('13_PROJECTS_BROWSER');
  const emptyOpener = page.getByRole('button', {name: 'Add first project', exact: true});
  await emptyOpener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(emptyOpener).toBeFocused();
  await page.getByRole('button', {name: 'Add project', exact: true}).click();
  const drawer = page.getByRole('dialog', {name: 'Add a project'});
  await drawer.getByLabel('Project title').fill('Private browser project');
  await drawer.getByLabel('Summary (optional)').fill('Disposable local test project');
  await capture('14_PROJECT_DRAWER_BROWSER');
  await drawer.getByRole('button', {name: 'Save project'}).click();
  await expect(page.getByRole('status')).toContainText('Saved privately');
  await page.getByRole('link', {name: 'Private browser project', exact: true}).click();
  await expect(page.getByLabel('Project title')).toHaveValue('Private browser project');
  const projectPath = new URL(page.url()).pathname;
  await page.getByLabel('Short description').fill('Updated through the owner revision writer');
  await page.getByRole('button', {name: 'Save changes'}).click();
  await expect(page.getByRole('status')).toHaveText('Private draft saved.');
  await page.reload();
  await expect(page.getByLabel('Short description')).toHaveValue('Updated through the owner revision writer');
  await expect(page.getByText('SAVED DRAFT · REVISION 1')).toBeVisible();
  await capture('15_PROJECT_DETAIL_BROWSER');

  await page.getByRole('button', {name: 'Case study', exact: true}).click();
  await page.getByRole('button', {name: 'Add section'}).click();
  await page.getByLabel('Section title', {exact: true}).fill('Design decisions');
  await page.getByLabel('Section content', {exact: true}).fill('Private project narrative.');
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  await page.getByRole('button', {name: 'Case study', exact: true}).click();
  await expect(page.getByLabel('Section title', {exact: true})).toHaveValue('Design decisions');
  await page.getByRole('button', {name: 'Save sections'}).click();
  await expect(page.getByRole('status')).toHaveText('Private case study saved.');
  await page.reload();
  await page.getByRole('button', {name: 'Case study', exact: true}).click();
  await expect(page.getByLabel('Section content', {exact: true})).toHaveValue('Private project narrative.');

  await page.goto('/app/portfolios');
  await expect(page.getByRole('heading', {name: 'No portfolios yet.'})).toBeVisible();
  await capture('16_PORTFOLIO_LIBRARY_BROWSER');
  await page.getByRole('link', {name: 'Create portfolio', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Choose your foundation.'})).toBeVisible();
  await capture('17_PORTFOLIO_CHOOSER_BROWSER');
  await page.getByLabel('Portfolio name').fill('Browser portfolio');
  await page.getByRole('button', {name: 'Choose template and create draft'}).click();
  await expect(page.getByRole('heading', {name: 'Browser portfolio', exact: true, level: 1})).toBeVisible();
  const editorPath = new URL(page.url()).pathname;
  await capture('18_PORTFOLIO_EDITOR_BROWSER');
  await page.getByRole('button', {name: /arc hero title/i}).click();
  await page.getByLabel('Text content').fill('Portfolio draft title');
  await page.getByRole('button', {name: 'Apply text'}).click();
  await capture('19_CONTENT_INSPECTOR_BROWSER');
  await page.getByRole('button', {name: 'Sections', exact: true}).click();
  await page.getByLabel('Section layout').selectOption('contact@1');
  await page.getByRole('button', {name: 'Add section', exact: true}).click();
  await expect(page.getByRole('button', {name: /new section: title/i})).toBeVisible();
  await capture('20_SECTIONS_BROWSER');
  await page.getByRole('button', {name: 'Save draft'}).click();
  await expect(page.getByRole('status')).toHaveText('Private portfolio draft saved.');
  await page.reload();
  await expect(page.getByText('Portfolio draft title', {exact: true})).toBeVisible();
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.getByRole('heading', {name: 'Continue on a larger screen.'})).toBeVisible();

  const foreign = await browser.newContext({baseURL: testInfo.project.use.baseURL});
  try {
    const other = await foreign.newPage();
    await signIn(other, outsider);
    await other.goto(projectPath);
    await expect(other.getByRole('alert')).toContainText('Project unavailable');
    await expect(other.getByLabel('Project title')).toHaveCount(0);
    await expect(other.getByText('Private browser project', {exact: true})).toHaveCount(0);
    await other.setViewportSize({width: 1534, height: 960});
    await other.goto(editorPath);
    await expect(other.getByRole('alert')).toContainText('Portfolio unavailable.');
    await expect(other.getByText('Portfolio draft title', {exact: true})).toHaveCount(0);
  } finally {
    await foreign.close();
  }
});
