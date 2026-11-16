import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  const decoded:unknown=await response.json();
  if(!decoded||typeof decoded!=='object'||!('id' in decoded)||
      typeof decoded.id!=='string'||!/^[0-9a-f-]{36}$/i.test(decoded.id))
    throw new Error('Local GoTrue fixture did not return an owner identifier.');
  return {id:decoded.id,email, password};
}

/** Only isolated CI Postgres on loopback: strictly never the hosted project.
 * The privileged SQL is test fixture setup; browser calls remain owner JWT. */
function grantLocalOperatorRole(userId:string){
  if(process.env.KADMEION_LOCAL_BROWSER!=='1'||process.env.VITE_SUPABASE_URL!==origin||
     !/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(userId))
    throw new Error('Operator fixture is restricted to disposable local Supabase.');
  const envText=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:15000});
  const match=/^(?:export )?DB_URL=["']?([^"'\r\n]+)["']?$/m.exec(envText);
  if(!match?.[1])throw new Error('Local PostgreSQL connection unavailable.');
  const url=new URL(match[1]);
  if(url.protocol!=='postgresql:'||!['localhost','127.0.0.1'].includes(url.hostname)||
     url.port!=='54322'||url.username!=='postgres'||url.pathname!=='/postgres')
    throw new Error('Refusing any nonlocal PostgreSQL fixture target.');
  const sql="insert into kadmeion_private.operator_roles(user_id,role) values (:'actor_id'::uuid,'administrator');";
  execFileSync('psql',['-X','-q','-v','ON_ERROR_STOP=1','-v','actor_id='+userId],{
    input:sql,encoding:'utf8',timeout:15000,
    env:{...process.env,PGHOST:url.hostname,PGPORT:url.port,
      PGDATABASE:'postgres',PGUSER:'postgres',PGPASSWORD:decodeURIComponent(url.password)}
  });
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
  test.setTimeout(150_000);
  const [owner, outsider] = await Promise.all([localUser('CI Portfolio Owner'), localUser('CI Other Owner')]);
  const captureDir = process.env.KADMEION_BROWSER_CAPTURE_DIR;
  async function capture(name: string) {
    if (!captureDir) return;
    await mkdir(captureDir, {recursive: true});
    // Evidence captures compare the top of the actual document, not wherever
    // Playwright last scrolled to focus an editor control.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({path: captureDir + '/' + name + '.png', animations: 'disabled'});
  }

  await page.setViewportSize({width: 1600, height: 1000});
  await signIn(page, owner);
  await page.getByRole('link', {name: 'Open private workspace'}).click();
  await expect(page.getByRole('heading', {name: 'A place for what you build next.'})).toBeVisible();
  await capture('11_WORKSPACE_BROWSER');
  await expect(page.getByRole('link', {name: 'Create portfolio'})).toHaveAttribute('href', '/app/portfolios/new');
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.getByRole('button', {name: 'Sign out', exact: true})).toBeVisible();
  const mobileMenu = page.getByRole('button', {name: 'Menu', exact: true});
  const workspaceNav = page.getByRole('navigation', {name: 'Workspace navigation'});
  await expect(workspaceNav).toBeHidden();
  await mobileMenu.click();
  await expect(mobileMenu).toHaveAttribute('aria-expanded', 'true');
  await workspaceNav.getByRole('link', {name: 'Profile'}).focus();
  await page.keyboard.press('Escape');
  await expect(mobileMenu).toBeFocused();
  await expect(workspaceNav).toBeHidden();
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const overflowing = await page.evaluate(() => [...document.querySelectorAll('main *, header *')]
    .filter(element => element.getBoundingClientRect().right > innerWidth + 2)
    .slice(0, 10).map(element => element.tagName + '.' + element.getAttribute('class')));
  expect(pageWidth, 'Workspace overflow: ' + overflowing.join(', ')).toBeLessThanOrEqual(392);
  await page.setViewportSize({width: 1600, height: 1000});

  for (const restricted of ['/app/operations/users', '/app/operations/moderation', '/app/operations/appeals']) {
    await page.goto(restricted);
    await expect(page.getByRole('heading', {name: 'Restricted operations.'})).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Only verified operators');
    await expect(page.getByRole('navigation', {name: 'Restricted operation areas'})).toHaveCount(0);
  }
  await page.goto('/app');

  await page.goto('/app/profile');
  await expect(page.getByLabel('Display name', {exact: true})).toBeVisible();
  const stale = await page.context().newPage();
  try {
    await stale.goto('/app/profile');
    await expect(stale.getByLabel('Display name', {exact: true})).toBeVisible();
    await page.getByLabel('Headline', {exact: true}).fill('Private developer draft');
    await page.getByRole('button', {name: 'Skills & links', exact: true}).click();
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
    const privatePreview = page.getByRole('complementary', {name: 'Public profile preview'});
    await expect(privatePreview.getByText('Private developer draft')).toBeVisible();
    await expect(privatePreview.getByRole('checkbox', {name: 'Include Display name in preview'})).toBeChecked();
    await privatePreview.getByRole('checkbox', {name: 'Include Headline in preview'}).uncheck();
    await expect(privatePreview.getByText('Private developer draft')).toBeHidden();
    await expect(page.getByRole('button', {name: 'Save profile draft'})).toBeDisabled();
    await privatePreview.getByRole('checkbox', {name: 'Include Headline in preview'}).check();
    await page.getByRole('button', {name: 'Skills & links', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Remove TypeScript'})).toBeVisible();
    await page.getByRole('button', {name: 'Profile', exact: true}).click();
    await capture('12_PROFILE_BROWSER');
  } finally {
    await stale.close();
  }

  await page.goto('/app/growth/goals');
  await expect(page.getByRole('heading', {name: 'Your goals', exact: true, level: 1})).toBeVisible();
  await page.getByLabel('Goal title').fill('CI private practice goal');
  await page.getByLabel('Description').fill('Owner-only browser learning plan');
  await page.getByLabel('Optional target value').fill('10');
  await page.getByLabel('Target unit').fill('sessions');
  await page.getByRole('button', {name: 'Create private goal'}).click();
  await expect(page.getByRole('status')).toContainText('Owner-private goal saved.');
  await expect(page.getByRole('button', {name: 'CI private practice goal'})).toBeVisible();
  await page.getByRole('button', {name: 'CI private practice goal'}).click();
  await page.getByLabel('New absolute progress value').fill('3');
  await page.getByLabel('Manual progress note').fill('Private self-reported update');
  await page.getByRole('button', {name: 'Record manual progress'}).click();
  await expect(page.getByText('Manual progress saved privately.', {exact: true})).toBeVisible();
  await page.getByLabel('New milestone').fill('Finish the basic exercises');
  await page.getByRole('button', {name: 'Add milestone'}).click();
  await expect(page.getByText('Milestone saved privately.', {exact: true})).toBeVisible();
  await capture('38_PRIVATE_GOALS_BROWSER');
  await page.goto('/app/growth');
  await expect(page.getByText('Private progress, not a leaderboard.')).toBeVisible();
  await capture('35_GROWTH_BROWSER');
  await page.goto('/app/growth/activity');
  await page.getByLabel('Activity goal').selectOption({label: 'CI private practice goal'});
  await expect(page.getByText('Private self-reported update')).toBeVisible();
  await capture('36_ACTIVITY_BROWSER');
  await page.goto('/app/growth/devscore');
  await expect(page.getByText('A numeric DevScore is unavailable.')).toBeVisible();
  await capture('37_DEVSCORE_BROWSER');
  await page.goto('/app/analytics');
  await expect(page.getByRole('button', {name: 'Enable portfolio analytics'})).toBeDisabled();
  await capture('39_ANALYTICS_BROWSER');
  await page.goto('/app/integrations');
  const gitHubCard = page.getByRole('article', {name: 'GitHub'});
  await gitHubCard.getByLabel('Public handle').fill('ci-browser-owner');
  await gitHubCard.getByRole('button', {name: 'Save private link'}).click();
  await expect(gitHubCard.getByRole('status')).toContainText('No provider sync or ownership verification');
  await expect(gitHubCard.getByText('https://github.com/ci-browser-owner')).toBeVisible();
  await capture('40_CONNECTIONS_BROWSER');
  await page.reload();
  await expect(page.getByRole('article', {name: 'GitHub'}).getByText('https://github.com/ci-browser-owner')).toBeVisible();

  await page.goto('/app/onboarding');
  await expect(page.getByRole('group', {name: 'Choose your next step'})).toBeVisible();
  await capture('10_ONBOARDING_BROWSER');
  const initialChoice = page.getByRole('radio', {name: /Create a portfolio/});
  await initialChoice.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', {name: /Connect developer accounts/})).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(initialChoice).toBeChecked();
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
  await drawer.getByText('Edit private URL slug', {exact: true}).click();
  await expect(drawer.getByRole('textbox', {name: /^Private URL slug/})).toHaveValue('private-browser-project');
  await drawer.getByText('Edit private URL slug', {exact: true}).click();
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
  await expect(page.getByRole('heading', {name: 'Case study sections'})).toBeVisible();
  await expect(page.getByRole('group', {name: 'Design decisions'})).toBeVisible();
  await expect(page.getByLabel('Section content', {exact: true})).toHaveValue('Private project narrative.');

  await page.goto('/app/portfolios');
  await expect(page.getByRole('heading', {name: 'No portfolios yet.'})).toBeVisible();
  await expect(page.locator('img.ws-brand-folio')).toHaveAttribute('src','/brand/kadmeion-open-folio.svg');
  await capture('16_PORTFOLIO_LIBRARY_BROWSER');
  await page.getByRole('link', {name: 'Create portfolio', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Choose your foundation.'})).toBeVisible();
  await capture('17_PORTFOLIO_CHOOSER_BROWSER');
  const selectedLayout = page.locator('.ws-preset-feature');
  await page.getByRole('radio', {name: 'Blank', exact: true}).check();
  await expect(selectedLayout.getByRole('heading', {name: 'Blank'})).toBeVisible();
  await page.getByRole('radio', {name: 'Arc', exact: true}).check();
  await expect(selectedLayout.getByRole('heading', {name: 'Arc'})).toBeVisible();
  await page.getByLabel('Portfolio name').fill('Browser portfolio');
  await page.getByRole('button', {name: 'Choose template and create draft'}).click();
  await expect(page.getByRole('heading', {name: 'Browser portfolio', exact: true, level: 1})).toBeVisible();
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const editorPath = new URL(page.url()).pathname;
  await expect(page.getByLabel('Text content')).toBeVisible();
  const panelBar=page.getByRole('navigation',{name:'Editor panels'});
  await expect(panelBar).toBeVisible();
  await expect(panelBar.getByRole('button',{name:'Content',exact:true})).toHaveAttribute('aria-pressed','true');
  const panelButton=await panelBar.getByRole('button',{name:'Content',exact:true}).evaluate(button=>({
    height:button.getBoundingClientRect().height,fontSize:parseFloat(getComputedStyle(button).fontSize)}));
  expect(panelButton.height).toBeGreaterThanOrEqual(42);
  expect(panelButton.fontSize).toBeGreaterThanOrEqual(12);
  await expect(page.getByText('Illustrative empty-slot copy · Never saved or published')).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit L1 title slot in preview'}))
    .toContainText('Build things that make a difference.');
  await expect(page.getByRole('button',{name:'arc hero title'})).toBeVisible();
  await capture('18_PORTFOLIO_EDITOR_BROWSER');
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await capture('18_EDITOR_RUNTIME_DARK_BROWSER');
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const beforeOrder=await page.locator('.ws-editor-layers>li summary').allTextContents();
  expect(beforeOrder[0]).toContain('Arc hero');
  await page.getByRole('button',{name:'Move Arc hero down'}).click();
  const afterOrder=await page.locator('.ws-editor-layers>li summary').allTextContents();
  expect(afterOrder[0]).toContain('Project showcase');
  expect(afterOrder[1]).toContain('Arc hero');
  await page.getByRole('button',{name:'Undo'}).click();
  const restoredOrder=await page.locator('.ws-editor-layers>li summary').allTextContents();
  expect(restoredOrder[0]).toContain('Arc hero');
  await page.getByRole('button', {name: /arc hero title/i}).click();
  await page.getByLabel('Text content').fill('Portfolio draft title');
  await page.getByRole('button', {name: 'Apply text'}).click();
  const previewSlot = page.getByRole('button', {name: 'Edit L1 title slot in preview'});
  await expect(previewSlot).toContainText('Portfolio draft title');
  await previewSlot.focus();
  await page.keyboard.press('Enter');
  await expect(previewSlot).toBeFocused();
  await expect(page.getByLabel('Text content')).toHaveValue('Portfolio draft title');
  await capture('19_CONTENT_INSPECTOR_BROWSER');
  // EDIT-02: rejected link remains visible in the owner's unsaved inspector
  // and must never silently become a project URL.
  await page.getByRole('button',{name:/arc hero cta1/i}).click();
  await page.getByLabel('url',{exact:true}).fill('javascript:alert(1)');
  await page.getByLabel('url',{exact:true}).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Link must be an HTTPS address');
  await expect(page.getByLabel('url',{exact:true})).toBeVisible();
  await expect(page.getByLabel('url',{exact:true})).toHaveAttribute('aria-invalid','true');
  await expect(page.getByRole('button',{name:'Save draft'})).toBeDisabled();
  await page.getByLabel('url',{exact:true}).fill('https://example.org/portfolio');
  await page.getByLabel('url',{exact:true}).press('Tab');
  await expect(page.getByLabel('url',{exact:true})).toHaveValue('https://example.org/portfolio');
  await expect(page.getByLabel('url',{exact:true})).toHaveAttribute('aria-invalid','false');
  await expect(page.getByRole('button',{name:'Save draft'})).toBeEnabled();
  // Keyboard activation must change selection between *different* canvas slots,
  // not merely reselect the currently focused title slot.
  await page.getByRole('button',{name:'Edit L1 title slot in preview'}).click();
  await expect(page.getByLabel('Text content')).toHaveValue('Portfolio draft title');
  await page.getByRole('button',{name:'Edit L1 cta1 slot in preview'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('url',{exact:true})).toHaveValue('https://example.org/portfolio');
  await page.getByRole('button', {name: 'Sections', exact: true}).click();
  await page.getByLabel('Section layout').selectOption('contact@1');
  await page.getByRole('button', {name: 'Add section', exact: true}).click();
  await expect(page.getByRole('button', {name: /new section: title/i})).toBeVisible();
  await page.getByRole('button', {name: /new section: title/i}).click();
  await page.getByRole('button', {name:'Choose compatible component'}).click();
  await expect(page.getByRole('heading',{name:'Components',level:2})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Slot compatibility',level:2})).toBeVisible();
  await page.getByLabel('Find components').fill('heading');
  await expect(page.getByRole('button',{name:/Project summary project-card@1/})).toHaveCount(0);
  await page.getByLabel('Find components').fill('');
  await capture('20_SECTIONS_BROWSER');
  await page.getByRole('button',{name:/Heading title-stacked@1/}).click();
  await page.getByRole('button',{name:'Add to empty slot'}).click();
  await expect(page.getByLabel('Text content')).toBeVisible();
  await page.getByLabel('Text content').fill('Reach out privately');
  await page.getByRole('button', {name:'Apply text'}).click();
  await expect(page.getByRole('button',{name:'Edit L8 title slot in preview'})
    .filter({hasText:'Reach out privately'})).toBeVisible();
  await page.getByRole('button', {name: 'My Components', exact: true}).click();
  await expect(page.getByText('You haven’t saved any component versions.')).toBeVisible();
  await capture('21_COMPONENT_LIBRARY_BROWSER');
  await page.getByRole('button', {name: 'Theme', exact: true}).click();
  await page.getByLabel('Portfolio theme').selectOption('dark');
  await page.getByLabel('Preview width').selectOption('390');
  await capture('22_THEME_INSPECTOR_BROWSER');
  await page.getByLabel('Portfolio theme').selectOption('light');
  await page.getByRole('button', {name: 'Assets', exact: true}).click();
  await expect(page.getByRole('heading',{name:'Your asset library is empty.'})).toBeVisible();
  await capture('23_ASSET_LIBRARY_BROWSER');
  await page.getByRole('button',{name:'Open private uploader'}).click();
  await expect(page.getByRole('button',{name:'Upload private image'})).toBeDisabled();
  await page.getByLabel('Owner project').selectOption(projectPath.split('/').at(-1)!);
  await page.getByLabel('Image alt text').fill('Tiny private image for an isolated browser test');
  await page.getByLabel('Private image file').setInputFiles({
    name:'broken-header-only.png',mimeType:'image/png',
    buffer:Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4])
  });
  await page.getByRole('button',{name:'Upload private image'}).click();
  await expect(page.locator('.ws-asset-manager').getByRole('alert'))
    .toContainText('cannot be decoded');
  await page.getByLabel('Private image file').setInputFiles({
    name:'browser-test.png',mimeType:'image/png',
    buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpH7DwABpAE8k4sOtwAAAABJRU5ErkJggg==','base64')
  });
  await page.getByRole('button',{name:'Upload private image'}).click();
  await expect(page.locator('.ws-asset-manager').getByRole('status'))
    .toContainText('Image uploaded and privately registered.');
  await expect(page.locator('.ws-asset-gallery').getByText('Tiny private image for an isolated browser test',{exact:true})).toBeVisible();
  await capture('23_ASSET_UPLOAD_CONFIRMED_BROWSER');
  // The portfolio has local revision operations at this point. Saving before
  // a hard reload is essential; otherwise reload correctly loses unsaved work.
  await page.getByRole('button',{name:'Back to editor canvas'}).click();
  await expect(page.getByRole('button',{name:'Save draft'})).toBeEnabled();
  await page.getByRole('button', {name: 'Save draft'}).click();
  await expect(page.getByRole('status')).toHaveText('Private portfolio draft saved.');
  await page.reload();
  await page.getByRole('button',{name:'Assets',exact:true}).click();
  await expect(page.locator('.ws-asset-gallery').getByText('Tiny private image for an isolated browser test',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to editor canvas'}).click();

  await page.getByRole('button', {name: 'Source', exact: true}).click();
  await expect(page.getByRole('navigation',{name:'Source files'})).toBeVisible();
  await expect(page.getByLabel('Readonly generated file')).toBeVisible();
  await expect(page.getByText('Code execution disabled')).toBeVisible();
  await expect(page.getByRole('button',{name:'Apply owned source to draft'})).toHaveCount(0);
  const sourceColumns=await page.locator('.ws-source-explorer').evaluate(root=>{
    const left=root.querySelector('.ws-source-tree')?.getBoundingClientRect();
    const center=root.querySelector('.ws-source-editor')?.getBoundingClientRect();
    const right=root.querySelector('.ws-source-diagnostics')?.getBoundingClientRect();
    return {left:left?.width??0,center:center?.width??0,right:right?.width??0};
  });
  if((page.viewportSize()?.width??0)>=1151){
    expect(sourceColumns.center).toBeGreaterThan(sourceColumns.left*2.25);
    expect(sourceColumns.center).toBeGreaterThan(sourceColumns.right*2);
  }
  await capture('24_SOURCE_BROWSER');
  await page.getByRole('button',{name:'Back to editor canvas'}).click();
  await expect(page.getByRole('button',{name:'Save draft'})).toBeDisabled();
  await page.setViewportSize({width:920,height:850});
  await expect(page.getByRole('navigation',{name:'Editor panels'})).toBeVisible();
  const editorOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(editorOverflow,'Narrow laptop editor horizontal overflow').toBeLessThanOrEqual(2);
  await page.setViewportSize({width:1600,height:1000});
  await page.reload();
  await expect(page.getByRole('button', {name:'Edit L1 title slot in preview'}))
    .toContainText('Portfolio draft title');
  await expect(page.getByLabel('Text content')).toHaveValue('Portfolio draft title');
  await page.getByRole('button',{name:/arc hero cta1/i}).click();
  await expect(page.getByLabel('url',{exact:true})).toHaveValue('https://example.org/portfolio');
  await page.getByRole('button', {name: 'History', exact: true}).click();
  await expect(page.getByRole('heading',{name:'Revisions',level:2})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Diagnostics',level:2})).toBeVisible();
  // WAI-ARIA tabs must support keyboard-only traversal and a named panel.
  await page.getByRole('tab',{name:'History'}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Problems'})).toBeFocused();
  await expect(page.getByRole('heading',{name:'Validation has not been run here.'})).toBeVisible();
  await expect(page.getByRole('tabpanel',{name:'Problems'})).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab',{name:'Conflicts'})).toBeFocused();
  await expect(page.getByRole('heading',{name:'Concurrent-save checks happen on save.'})).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab',{name:'History'})).toBeFocused();
  await expect(page.getByRole('tabpanel',{name:'History'})).toBeVisible();
  await expect(page.getByRole('button', {name: /Revision 2/})).toBeVisible();
  await page.getByRole('button',{name:/Revision 2/}).click();
  await page.getByRole('button',{name:'Compare to working copy'}).click();
  await expect(page.getByRole('status',{name:'Actual snapshot comparison'}))
    .toContainText('Different project files');
  await capture('25_REVISION_HISTORY_BROWSER');
  const fullscreenPath = await page.getByRole('link', {name: 'Fullscreen saved preview'}).getAttribute('href');
  expect(fullscreenPath).toBeTruthy();
  await page.goto(fullscreenPath!);
  await expect(page.getByText('Portfolio draft title', {exact: true})).toBeVisible();
  await expect(page.getByRole('navigation', {name: 'Workspace navigation'})).toHaveCount(0);
  await capture('26_FULLSCREEN_BROWSER');
  await page.goto(editorPath);
  await page.getByRole('link',{name:'Preview modes'}).click();
  await expect(page.getByRole('heading',{name:'Preview modes',level:2})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Public projection',level:2})).toBeVisible();
  await capture('26_PREVIEW_MODES_BROWSER');
  await page.getByRole('button',{name:'Visitor appearance (simulation)'}).click();
  await expect(page.getByRole('status')).toContainText('not a published or visitor-accessible URL');
  await expect(page.getByLabel('Simulated visitor portfolio appearance')).toBeVisible();
  await page.getByLabel('Preview device').selectOption('390');
  await expect(page.getByText('Saved revision · No public delivery')).toBeVisible();
  await page.getByRole('button',{name:'Share portfolio'}).click();
  const shareDialog=page.getByRole('dialog',{name:'Share your work'});
  await expect(shareDialog).toBeVisible();
  // The visual background is an owner-private portfolio, not an editor shell.
  const shareScene=page.locator('.ws-share-scene');
  await expect(shareScene).toBeVisible();
  await expect(shareScene.locator('.portfolio-only-preview')).toBeVisible();
  await expect(shareScene).toHaveAttribute('data-public-delivery','disabled');
  await expect(shareScene.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);
  await expect(shareDialog.getByRole('button',{name:'Copy link'})).toBeDisabled();
  await expect(shareDialog.getByRole('button',{name:'Native Share unavailable'})).toBeDisabled();
  await expect(shareDialog.getByRole('textbox',{name:'Verified public link'}))
    .toHaveValue('No verified public URL');
  await page.keyboard.press('Escape');
  await expect(shareDialog).toHaveCount(0);
  await expect(page.locator('.ws-share-scene')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Share portfolio'})).toBeFocused();
  await page.getByRole('button',{name:'Share portfolio'}).click();
  await capture('34_SHARE_GATE_BROWSER');
  await shareDialog.getByRole('button',{name:'Done'}).click();
  await expect(shareDialog).toHaveCount(0);
  await page.getByRole('button',{name:/^Author preview/}).click();
  await expect(page.locator('.ws-preview-caution')).toContainText('Private author preview.');
  await page.goto(editorPath);
  await page.getByRole('link', {name: 'Release workspace'}).click();
  await expect(page.getByRole('heading', {name: 'Reviewer staging.'})).toBeVisible();
  await page.getByRole('button', {name: 'Freeze private revision'}).click();
  await expect(page.getByRole('status')).toHaveText('Private revision 2 frozen.');
  await capture('27_STAGING_BROWSER');
  await expect(page.getByRole('button', {name:'Copy public link unavailable'})).toBeDisabled();
  await page.getByRole('button', {name:'Register private reviewer grant'}).click();
  await expect(page.getByText('Registered; not externally servable')).toBeVisible();
  await expect(page.getByText('Disabled pending host verification')).toBeVisible();
  await page.getByRole('button', {name:'Revoke private reviewer grant'}).click();
  await page.getByRole('button', {name:'Confirm reviewer revocation'}).click();
  await expect(page.getByText('Revoked', {exact:true})).toBeVisible();
  await page.getByRole('link', {name: 'Publish preflight', exact: true}).click();
  await page.getByRole('button', {name: 'Run private preflight'}).click();
  await expect(page.getByRole('heading', {name: 'Preflight results'})).toBeVisible();
  await expect(page.getByText('Source manifest requires seo.title and seo.description.')).toBeVisible();
  await capture('29_PREFLIGHT_BROWSER');
  await page.getByRole('link', {name: 'Releases & rollback'}).click();
  await expect(page.getByRole('heading', {name: 'Release status'})).toBeVisible();
  await expect(page.getByText('Awaiting verification', {exact: true})).toBeVisible();
  await capture('30_RELEASES_BROWSER');
  await page.goto(editorPath);
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.getByRole('heading', {name: 'Continue on a larger screen.'})).toBeVisible();
  await capture('52_DEVICE_REQUIREMENTS_BROWSER');
  await page.setViewportSize({width: 1600, height: 1000});
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toBeVisible();
  await capture('41_SETTINGS_BROWSER');

  await page.getByRole('link', {name: 'Open privacy & sharing'}).click();
  await page.getByLabel('Display name', {exact: true}).check();
  await page.getByLabel('Save these preferences and withdraw any affected public profile projection').check();
  await page.getByRole('button', {name: 'Save sharing preferences'}).click();
  await expect(page.getByRole('status')).toHaveText('Sharing preferences saved privately.');
  await capture('42_PRIVACY_BROWSER');

  await page.goto('/app/notifications');
  await expect(page.getByRole('heading', {name: 'Inbox'})).toBeVisible();
  await expect(page.getByLabel('Reviewer activity')).toBeVisible();
  await capture('43_NOTIFICATIONS_BROWSER');

  await page.goto('/app/settings/security');
  await expect(page.getByRole('heading', {name: 'Account security'})).toBeVisible();
  await page.getByRole('button', {name: 'Sign out other sessions'}).click();
  await expect(page.getByRole('status')).toHaveText('Other sessions were signed out.');
  await capture('44_SECURITY_BROWSER');

  await page.goto('/app/trash');
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  await capture('45_TRASH_BROWSER');

  await page.goto('/app/export');
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download application metadata'}).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe('kadmeion-account-metadata.json');
  await expect(page.getByRole('status')).toHaveText('Application metadata download prepared.');
  await capture('46_EXPORT_BROWSER');

  await page.goto('/app/settings/account/delete');
  await page.getByRole('button', {name: 'Review deletion prerequisites'}).click();
  await expect(page.getByRole('heading', {name: 'Private inventory'})).toBeVisible();
  await capture('47_ACCOUNT_EXIT_BROWSER');

  const foreign = await browser.newContext({baseURL: testInfo.project.use.baseURL});
  try {
    const other = await foreign.newPage();
    await signIn(other, outsider);
    await other.goto(projectPath);
    await expect(other.getByRole('alert')).toContainText('Project unavailable');
    await expect(other.getByLabel('Project title')).toHaveCount(0);
    await expect(other.getByText('Private browser project', {exact: true})).toHaveCount(0);
    await other.setViewportSize({width: 1600, height: 1000});
    await other.goto(editorPath);
    await expect(other.getByRole('alert')).toContainText('Portfolio unavailable.');
    await expect(other.getByText('Portfolio draft title', {exact: true})).toHaveCount(0);
  } finally {
    await foreign.close();
  }
});


test('verified local operator can read case-scoped views without impersonation or public release',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1',
    'Privileged operator role is granted only in an ephemeral Supabase CI database.');
  test.setTimeout(95_000);
  const operator=await localUser('CI Restricted Moderator');
  const subject=await localUser('CI Target Account');
  grantLocalOperatorRole(operator.id);
  await page.setViewportSize({width:1600,height:1000});
  await signIn(page,operator);
  await page.goto('/app/operations/users');
  await expect(page.getByRole('heading',{name:'Admin users',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Scoped case directory'})).toBeVisible();
  const rationale='This is an isolated test case documenting a simulated serious report.';
  await page.getByLabel('Exact target user ID').fill(subject.id);
  await page.getByLabel('Case summary').fill(rationale);
  await page.getByLabel('I confirm the serious-abuse scope and understand this is audit-only.').check();
  await page.getByRole('button',{name:'Record private case'}).click();
  await expect(page.getByRole('status')).toContainText('Private audit case recorded.');
  await expect(page.getByText('Owner ID '+subject.id)).toBeVisible();
  const dir=process.env.KADMEION_BROWSER_CAPTURE_DIR;
  if(dir){await mkdir(dir,{recursive:true});await page.screenshot({
    path:dir+'/48_ADMIN_USERS_BROWSER.png',animations:'disabled'
  });}
  await page.goto('/app/operations/moderation');
  await expect(page.getByRole('heading',{name:'Portfolio moderation',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Submitted portfolio reports'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Private moderation hold'})).toBeVisible();
  await expect(page.getByText('No pending abuse reports were returned.')).toBeVisible();
  if(dir)await page.screenshot({path:dir+'/49_PORTFOLIO_MODERATION_BROWSER.png',animations:'disabled'});
  await page.goto('/app/operations/appeals');
  await expect(page.getByRole('heading',{name:'Appeals & case history',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Internal hold release'})).toBeVisible();
  await expect(page.getByText('No pending appeals were returned.')).toBeVisible();
  if(dir)await page.screenshot({path:dir+'/50_APPEALS_BROWSER.png',animations:'disabled'});
  // An administrator's private-case permissions are not public host authority.
  await expect(page.getByText('This does not republish content.',{exact:false})).toBeVisible();
});

test('F1 recovery request and password reset use isolated GoTrue and Mailpit', async ({ page }) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1', 'Requires the isolated Supabase CI job.');
  test.setTimeout(60_000);
  const user = await localUser('CI Recovery');
  const directory = process.env.KADMEION_BROWSER_CAPTURE_DIR;
  async function capture(screen: string) {
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: directory + '/' + screen + '_BROWSER.png', animations: 'disabled' });
  }

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/forgot-password');
  await page.getByRole('textbox', { name: 'Email address' }).fill(user.email);
  await page.getByRole('button', { name: 'Request recovery link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Delivery is not confirmed');
  await capture('09_RECOVERY_OUTCOME');
  await page.getByRole('button', {name: 'Request another link'}).click();
  await expect(page.getByRole('heading', {name: 'Reset your password.'})).toBeFocused();

  const mailpit = 'http://127.0.0.1:54324';
  let messageId: string | undefined;
  await expect.poll(async () => {
    const response = await fetch(mailpit + '/api/v1/messages?limit=100', { redirect: 'error' });
    if (!response.ok) return false;
    const inbox = await response.json() as { messages?: { ID: string; To?: { Address: string }[] }[] };
    messageId = inbox.messages?.find(message => message.To?.some(to => to.Address === user.email))?.ID;
    return !!messageId;
  }, { timeout: 12_000 }).toBe(true);
  const messageResponse = await fetch(mailpit + '/api/v1/message/' + encodeURIComponent(messageId!), { redirect: 'error' });
  expect(messageResponse.ok).toBe(true);
  const message = await messageResponse.json() as { Text?: string; HTML?: string };
  const rawLinks = ((message.Text ?? '') + '\n' + (message.HTML ?? '')).match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const verification = rawLinks.map(link => URL.parse(link.replaceAll('&amp;', '&').replace(/[).,;]+$/, '')))
    .find(link => link?.origin === origin && link.pathname === '/auth/v1/verify' &&
      link.searchParams.get('type') === 'recovery' && link.searchParams.has('token'));
  if (!verification) throw new Error('Mailpit did not return a local recovery link.');
  const redeemed = await fetch(verification, { redirect: 'manual' });
  if (![302, 303].includes(redeemed.status)) throw new Error('Local GoTrue rejected the recovery link.');
  const redirect = URL.parse(redeemed.headers.get('location') ?? '');
  const fragment = new URLSearchParams(redirect?.hash.slice(1));
  if (redirect?.origin !== 'http://127.0.0.1:5173' || redirect.pathname !== '/reset-password' ||
      !fragment.has('access_token') || fragment.get('type') !== 'recovery')
    throw new Error('Local GoTrue did not return the expected recovery redirect.');

  let resumeVerification!: () => void;
  const verificationHeld = new Promise<void>(resolve => { resumeVerification = resolve; });
  await page.route(origin + '/auth/v1/user', async (route, request) => {
    if (request.method() === 'GET') await verificationHeld;
    await route.continue();
  });
  try {
    await page.setViewportSize({ width: 1586, height: 992 });
    await page.evaluate(hash => window.location.assign('/reset-password' + hash), redirect.hash);
    await expect(page.getByRole('heading', { name: 'Verifying your session.' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Verification steps' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    await capture('06_CALLBACK_RECOVERY_VERIFICATION');
  } finally {
    resumeVerification();
  }

  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.getByRole('heading', { name: 'Choose a new password.' })).toBeFocused();
  await capture('08_RESET');
  const newPassword = 'LocalChanged!' + randomUUID();
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeFocused();
  await signIn(page, {email: user.email, password: newPassword});
});

test('new email/password account can open the workspace immediately', async ({page}) => {
  test.setTimeout(60_000);
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1', 'Requires the isolated Supabase CI job.');
  const owner = {email:'instant-' + randomUUID() + '@testing.invalid', password:'LocalFixture!' + randomUUID()};
  await page.goto('/signup');
  await page.getByLabel('Display name', {exact:true}).fill('Instant Signup');
  await page.getByLabel('Preferred handle', {exact:true}).fill('instant_' + randomUUID().slice(0, 8));
  await page.getByLabel('Email address', {exact:true}).fill(owner.email);
  await page.getByLabel('Create password', {exact:true}).fill(owner.password);
  await page.getByLabel('Confirm password', {exact:true}).fill(owner.password);
  await page.getByRole('button', {name:'Create account', exact:true}).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', {name:'A place for what you build next.'})).toBeVisible();
  await page.getByRole('button', {name:'Sign out', exact:true}).click();
  await expect(page).toHaveURL('/signin');
  await signIn(page, owner);
  await page.getByRole('link', {name:'Open private workspace'}).click();
  await expect(page).toHaveURL('/app');
  const populatedRoutes = [
    ['/app', 'A place for what you build next.'],
    ['/app/onboarding', 'Your developer identity starts here.'],
    ['/app/profile', 'Your developer profile.'],
    ['/app/projects', 'Project library.'],
    ['/app/portfolios', 'Your portfolios.'],
    ['/app/portfolios/new', 'Choose your foundation.'],
  ] as const;
  for (const width of [1920, 1366, 900, 390, 320]) {
    await page.setViewportSize({width, height:768});
    for (const [route, heading] of populatedRoutes) {
      await page.goto(route);
      await expect(page.getByRole('heading', {name: heading, exact: true, level: 1})).toBeVisible();
      if (route === '/app/profile') await expect(page.getByLabel('Display name', {exact: true})).toBeVisible();
      if (route === '/app/portfolios/new' && width < 900)
        await expect(page.getByRole('heading', {name: 'Continue on a larger screen.'})).toBeVisible();
      const layout = await page.locator('.ws-shell').evaluate(element => ({
        width:element.getBoundingClientRect().width, viewport:document.documentElement.clientWidth,
        scrollWidth:document.documentElement.scrollWidth,
      }));
      expect(layout.width, route + ' at ' + width).toBeGreaterThanOrEqual(layout.viewport - 1);
      expect(layout.scrollWidth, route + ' at ' + width).toBeLessThanOrEqual(layout.viewport + 2);
    }
  }
});
