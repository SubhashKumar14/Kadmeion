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
    await page.screenshot({path: captureDir + '/' + name + '.png', animations: 'disabled'});
  }

  await page.setViewportSize({width: 1600, height: 1000});
  await signIn(page, owner);
  await page.getByRole('link', {name: 'Open private workspace'}).click();
  await expect(page.getByRole('heading', {name: /Make room for/})).toBeVisible();
  await capture('11_WORKSPACE_BROWSER');

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
  await page.getByLabel('Portfolio name').fill('Browser portfolio');
  await page.getByRole('button', {name: 'Choose template and create draft'}).click();
  await expect(page.getByRole('heading', {name: 'Browser portfolio', exact: true, level: 1})).toBeVisible();
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const editorPath = new URL(page.url()).pathname;
  await expect(page.getByLabel('Text content')).toBeVisible();
  await expect(page.getByText('Illustrative empty-slot copy · Never saved or published')).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit L1 title slot in preview'}))
    .toContainText('Build things that make a difference.');
  await expect(page.getByRole('button',{name:'arc hero title'})).toBeVisible();
  await capture('18_PORTFOLIO_EDITOR_BROWSER');
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
  await capture('24_SOURCE_BROWSER');
  await page.getByRole('button',{name:'Back to editor canvas'}).click();
  await expect(page.getByRole('button',{name:'Save draft'})).toBeDisabled();
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
