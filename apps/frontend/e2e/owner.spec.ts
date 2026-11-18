import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type Page, type BrowserContext } from '@playwright/test';
import { SupabaseBrowserAuthPort, type OwnerPrivateCursorV1 } from '../../auth-web/src/supabase-auth-port.ts';
import { auditAccessibility } from './accessibility.ts';
import { PrivateServerAssetByteAttestor } from '../../../packages/storage-adapters/src/private-server-asset-byte-attestor.ts';
import { importPortfolioSourceZip, readStrictStoredZip } from '../../../packages/storage-adapters/src/portable-source-archive.ts';

const origin = 'http://127.0.0.1:54321';

 // Allowlisted diagnostics only: never serialize request URLs, query strings,
 // browser console, headers, error text, response bodies or owner content.
test.beforeEach(async ({page}, info) => {
  const events: Array<{pathname:string;status:number|null;category:string}> = [];
  const paths = new Set(['/auth/v1/user','/auth/v1/token','/rest/v1/projects',
    '/rest/v1/profiles','/rest/v1/portfolios','/rest/v1/rpc/complete_private_account_exit_reauth',
    '/rest/v1/private_account_erasure_requests','/rest/v1/rpc/read_private_project_thumbnail',
    '/rest/v1/rpc/set_private_project_thumbnail','/rest/v1/rpc/register_private_project_image']);
  const pathOf=(raw:string)=>{
    const u=new URL(raw);
    return u.origin===origin ? (paths.has(u.pathname)?u.pathname:'/private-api/other') : null;
  };
  page.on('response',response=>{
    const pathname=pathOf(response.url());
    if(pathname&&response.status()>=400&&events.length<80){
      const status=response.status();
      events.push({pathname,status,category:status===401?'AUTH':status===403?'DENIED':
        status===409?'CONFLICT':status===429?'RATE_LIMIT':status>=500?'UNAVAILABLE':'HTTP_OTHER'});
    }
  });
  page.on('requestfailed',request=>{
    const pathname=pathOf(request.url());
    if(pathname&&events.length<80)events.push({pathname,status:null,category:'TRANSPORT'});
  });
  // A callback runs at fixture teardown before the page is closed.
  // Only the predeclared route family is retained, never a dynamic ID.
  info.annotations.push({type:'sanitized-diagnostics',description:'allowlisted fields only'});
  // Attach on failure using afterEach below; store only already sanitized data.
  safeDiagnostics.set(page,events);
});
const safeDiagnostics=new WeakMap<Page,Array<{pathname:string;status:number|null;category:string}>>();
test.afterEach(async ({page},info)=>{
  if(info.status===info.expectedStatus)return;
  const p=new URL(page.url()).pathname;
  const pathname=/^\/app\/(projects|portfolios)\/.+/.test(p)
    ? (p.startsWith('/app/projects/')?'/app/projects/:id':'/app/portfolios/:id')
    : /^\/(app(?:\/(?:growth(?:\/(?:activity|devscore|goals))?|settings(?:\/(?:privacy|security|account\/delete))?|projects|portfolios|analytics|integrations|notifications|trash|export))?|signin)$/.test(p)?p:'/other';
  const gate=await page.locator('.ws-heading').first().isVisible().catch(()=>false)
    ?'WORKSPACE_VISIBLE':await page.getByRole('button',{name:'Retry verification'}).isVisible().catch(()=>false)
      ?'LOCKED':'UNKNOWN_OR_CHECKING';
  const dir='/tmp/kadmeion-owner-captures';
  await mkdir(dir,{recursive:true});
  await writeFile(dir+'/'+randomUUID()+'.route-diagnostics.json',JSON.stringify({
    pathname,gate,events:safeDiagnostics.get(page)??[]
  }),{encoding:'utf8',mode:0o600});
});


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
function runLocalFixtureSql(sql:string, userId:string, itemId?:string){
  if(process.env.KADMEION_LOCAL_BROWSER!=='1'||process.env.VITE_SUPABASE_URL!==origin||
     !/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(userId) ||
     (itemId!==undefined && !/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(itemId)))
    throw new Error('SQL fixtures are restricted to disposable local Supabase.');
  const envText=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:15000});
  const match=/^(?:export )?DB_URL=["']?([^"'\r\n]+)["']?$/m.exec(envText);
  if(!match?.[1])throw new Error('Local PostgreSQL connection unavailable.');
  const url=new URL(match[1]);
  if(url.protocol!=='postgresql:'||!['localhost','127.0.0.1'].includes(url.hostname)||
     url.port!=='54322'||url.username!=='postgres'||url.pathname!=='/postgres')
    throw new Error('Refusing any nonlocal PostgreSQL fixture target.');
  const variables=['-v','actor_id='+userId,...(itemId===undefined?[]:['-v','item_id='+itemId])];
  return execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1',...variables],{
    input:sql,encoding:'utf8',timeout:15000,
    env:{...process.env,PGHOST:url.hostname,PGPORT:url.port,
      PGDATABASE:'postgres',PGUSER:'postgres',PGPASSWORD:decodeURIComponent(url.password)}
  }).trim();
}

function grantLocalOperatorRole(userId:string){
  runLocalFixtureSql("insert into kadmeion_private.operator_roles(user_id,role) values (:'actor_id'::uuid,'administrator');",userId);
}

async function signIn(page: Page, user: {email: string; password: string}) {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(user.email);
  await page.locator('#signin-password').fill(user.password);
  const requestResults: string[] = [];
  function onResponse(response: import('@playwright/test').Response) {
    const url = new URL(response.url());
    if (url.origin === origin) requestResults.push((url.pathname==='/auth/v1/token'?'/auth/v1/token':url.pathname==='/auth/v1/user'?'/auth/v1/user':'/private-api/other') + ' HTTP ' + response.status());
  }
  function onRequestFailed(request: import('@playwright/test').Request) {
    const url = new URL(request.url());
    if (url.origin === origin) requestResults.push((url.pathname==='/auth/v1/token'?'/auth/v1/token':url.pathname==='/auth/v1/user'?'/auth/v1/user':'/private-api/other') + ' TRANSPORT');
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
  test.setTimeout(200_000);
  const [owner, outsider] = await Promise.all([localUser('CI Portfolio Owner'), localUser('CI Other Owner')]);
  const captureDir = process.env.KADMEION_BROWSER_CAPTURE_DIR;
  async function capture(name: string) {
    await auditAccessibility(page,name,captureDir);
    if (!captureDir) return;
    await mkdir(captureDir, {recursive: true});
    // Evidence captures compare the top of the actual document, not wherever
    // Playwright last scrolled to focus an editor control.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({path: captureDir + '/' + name + '.png', animations: 'disabled'});
  }

  // A transient provider transport failure must never reveal the owner shell.
  // Exercise the existing explicit retry once; do not re-sign in or bypass
  // server /user verification. Persistent denial remains a test failure.
  async function navigateVerified(target:string,heading:string){
    await page.goto(target);
    const expected=page.getByRole('heading',{name:heading,level:1});
    const locked=page.getByRole('heading',{name:'Sign in required.',level:1});
    const unavailable=page.getByRole('heading',{name:'Owner verification unavailable.',level:1});
    await expect.poll(async()=>{
      if(await expected.isVisible())return 'VERIFIED';
      if(await locked.isVisible())return 'LOCKED';
      if(await unavailable.isVisible())return 'UNAVAILABLE';
      return 'CHECKING';
    },{timeout:12_000}).not.toBe('CHECKING');
    if(await locked.isVisible()||await unavailable.isVisible()){
      await expect(page.locator('.ws-shell')).toHaveCount(0);
      const retry=page.getByRole('button',{name:'Retry verification'});
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(expected).toBeVisible({timeout:10_000});
    }
    await expect(expected).toBeVisible();
  }
  await page.setViewportSize({width: 1600, height: 1000});
  await signIn(page, owner);
  await page.getByRole('link', {name: 'Open private workspace'}).click();
  await expect(page.getByRole('heading', {name: 'A place for what you build next.'})).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link',{name:'Skip to workspace content'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
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
    await expect(page.getByRole('alert')).toContainText('did not authorize this session');
    await expect(page.getByRole('navigation', {name: 'Restricted operation areas'})).toHaveCount(0);
  }
  // An infrastructure outage must remain fail-closed without falsely asserting
  // a role denial. No private case list, user directory or operator UI appears.
  const operatorRpc='**/rest/v1/rpc/operator_list_moderation_cases*';
  await page.route(operatorRpc, route => route.abort('failed'));
  await page.goto('/app/operations/users');
  await expect(page.getByRole('heading',{name:'Operator verification unavailable.'})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('not proof your role was denied');
  await expect(page.getByRole('navigation',{name:'Restricted operation areas'})).toHaveCount(0);
  await page.unroute(operatorRpc);
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
  await page.route('**/rest/v1/private_goal_progress_events?*',route=>route.abort(),{times:1});
  await page.getByLabel('Activity goal').selectOption({label: 'CI private practice goal'});
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Private self-reported update')).toHaveCount(0);
  await page.getByRole('button',{name:'Retry activity history'}).click();
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
  await expect(page.getByRole('status').filter({hasText:'Saved privately in your account.'})).toBeVisible();
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
  await expect(page.getByRole('button',{name:'Edit L1 title slot in preview — Build things that make a difference.'})).toBeVisible();
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
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('heading',{name:'Continue on a larger screen.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save draft'})).toHaveCount(0);
  await page.setViewportSize({width:1600,height:1000});
  await expect(page.getByLabel('url',{exact:true})).toHaveValue('javascript:alert(1)');
  await expect(page.getByLabel('url',{exact:true})).toHaveAttribute('aria-invalid','true');
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
  await expect(page.locator('.ws-asset-manager').getByRole('status').filter({hasText:'Image uploaded and privately registered.'}))
    .toBeVisible();
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
  await expect(page.getByRole('link',{name:'Open private release preflight'}))
    .toHaveAttribute('href',editorPath.replace('/edit','/publish'));
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
  const revisionPreview=page.getByRole('region',{name:'Current revision preview'});
  await revisionPreview.focus();
  await expect(revisionPreview).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(()=>revisionPreview.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
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
  await expect(page.getByRole('heading',{name:'What the reviewer would see'})).toBeVisible();
  await expect(page.locator('.ws-release-visual .pv-site')).toBeVisible();
  await expect(page.getByText('Current saved draft · Not yet frozen')).toBeVisible();
  await expect(page.getByText('Saved draft revision 2')).toBeVisible();
  const savedRevision=page.getByRole('combobox',{name:'Saved revision',exact:true});
  await expect(savedRevision).toBeVisible();
  await expect(savedRevision.locator('option')).toHaveCount(2);
  await savedRevision.selectOption('2');
  await page.getByRole('button', {name: 'Freeze private revision'}).click();
  await expect(page.getByRole('status').filter({hasText:'Private revision 2 frozen.'})).toBeVisible();
  await expect(page.getByText('Frozen revision 2 · Verified owner-private pin')).toBeVisible();
  await expect(page.locator('.ws-release-visual .pv-site')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Frozen private requests'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Frozen request selected'})).toHaveAttribute('aria-pressed','true');
  await capture('27_STAGING_BROWSER');
  await expect(page.getByRole('button', {name:'Copy public link unavailable'})).toBeDisabled();
  await page.getByRole('button', {name:'Register private reviewer grant'}).click();
  await expect(page.getByText('Registered; not externally servable')).toBeVisible();
  await expect(page.getByText('Disabled pending host verification')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', {name:'Frozen private requests'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use frozen revision 2'})).toBeVisible();
  await page.getByRole('button',{name:'Use frozen revision 2'}).click();
  await expect(page.getByRole('status').filter({hasText:'Exact owner-private frozen revision verified.'})).toBeVisible();
  await expect(page.getByRole('heading', {name:'Registered reviewer grants'})).toBeVisible();
  await expect(page.getByText('Registered (not servable)', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Review revocation'}).click();
  await expect(page.getByRole('button', {name:'Confirm reviewer revocation'})).toBeVisible();
  await page.getByRole('button', {name:'Confirm reviewer revocation'}).click();
  await expect(page.getByText('Revoked', {exact:true}).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Revoked', {exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Review revocation'})).toHaveCount(0);
  await page.getByRole('link', {name: 'Publish preflight', exact: true}).click();
  await expect(page.getByRole('heading',{name:'Preflight checks'})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Not evaluated.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Publish unavailable — host proof required'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Use frozen revision 2'})).toBeVisible();
  await page.getByRole('button',{name:'Use frozen revision 2'}).click();
  await expect(page.getByRole('status').filter({hasText:'Exact owner-private frozen revision verified.'})).toBeVisible();
  await page.getByRole('button', {name: 'Run private preflight'}).click();
  await expect(page.getByRole('heading', {name: 'Preflight results'})).toBeVisible();
  const preflightSummary=page.getByRole('group',{name:'Private preflight summary'});
  await expect(preflightSummary).toBeVisible();
  await expect(preflightSummary).toContainText('Blocking errors');
  await expect(preflightSummary).toContainText('Warnings');
  await expect(preflightSummary).toContainText('Passed checks');
  await expect(page.getByText('Source manifest requires seo.title and seo.description.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Download offline static preview ZIP'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Edit SEO metadata in private editor'}))
    .toHaveAttribute('href',editorPath+'?panel=Metadata');
  await expect(page.getByText('Private · Not published', {exact:true})).toBeVisible();
  await capture('29_PREFLIGHT_BROWSER');
  await page.getByRole('link', {name: 'Releases & rollback'}).click();
  await expect(page.getByRole('heading', {name: 'Private release pointer'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Frozen private requests'})).toBeVisible();
  await expect(page.getByText('Private revision 2 · Unlisted intent')).toBeVisible();
  await expect(page.getByText('Not published', {exact:false}).first()).toBeVisible();
  await expect(page.getByText('Awaiting verification', {exact: true})).toBeVisible();
  await capture('30_RELEASES_BROWSER');
  await page.getByRole('link', {name:'Sharing controls'}).click();
  await expect(page.getByRole('heading', {name:'Public sharing controls'})).toBeVisible();
  await expect(page.getByRole('button', {name:'Copy verified public URL'})).toBeDisabled();
  await expect(page.getByRole('button', {name:'Share verified public URL'})).toBeDisabled();
  await capture('34_SHARING_BROWSER');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('heading', {name:'Public sharing controls'})).toBeVisible();
  const shareWidths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,
    viewport:document.documentElement.clientWidth}));
  expect(shareWidths.scroll).toBeLessThanOrEqual(shareWidths.viewport+2);
  await capture('34_SHARING_PHONE_BROWSER');

  // F4/F6: audit the real authenticated release shell, not a screenshot-sized
  // mockup. These remain owner-private states; no host URL is enabled here.
  const releaseStages=[
    ['staging','Reviewer staging.','27_STAGING'],
    ['publish','Publish preflight.','29_PREFLIGHT'],
    ['releases','Releases & rollback.','30_RELEASES'],
    ['share','Sharing controls.','34_SHARING']
  ] as const;
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    for(const [stage,heading,label] of releaseStages){
      await navigateVerified(editorPath.replace('/edit','/'+stage),heading);
      await expect(page.getByRole('navigation',{name:'Release steps'})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
      const sizes=await page.evaluate(()=>({
        viewport:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth
      }));
      expect(sizes.scroll,stage+' dark route overflows at '+width+'px')
        .toBeLessThanOrEqual(sizes.viewport+2);
      if(width===390)await capture(label+'_DARK_PHONE_BROWSER');
    }
  }
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  await page.setViewportSize({width:390,height:844});
  for(const [stage,heading,label] of releaseStages){
    await navigateVerified(editorPath.replace('/edit','/'+stage),heading);
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    const sizes=await page.evaluate(()=>({
      viewport:document.documentElement.clientWidth,
      scroll:document.documentElement.scrollWidth
    }));
    expect(sizes.scroll,stage+' light route overflows at 390px')
      .toBeLessThanOrEqual(sizes.viewport+2);
    await capture(label+'_LIGHT_PHONE_BROWSER');
  }
  await page.setViewportSize({width:1600,height:1000});
  await page.goto(editorPath+'?panel=Metadata');
  await expect(page.getByRole('heading',{name:'Page metadata'})).toBeVisible();
  await page.getByLabel('SEO page title').fill('Saved author portfolio');
  await page.getByLabel('SEO description').fill('A developer portfolio written by its owner and saved privately.');
  await expect(page.getByRole('button',{name:'Save draft'})).toBeDisabled();
  await page.getByRole('button',{name:'Apply SEO metadata to draft'}).click();
  await expect(page.getByRole('button',{name:'Save draft'})).toBeEnabled();
  await page.getByRole('button',{name:'Save draft'}).click();
  await expect(page.getByRole('status').filter({hasText:'Private portfolio draft saved.'})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('SEO page title')).toHaveValue('Saved author portfolio');
  await page.goto(editorPath.replace('/edit', '/publish'));
  await expect(page.getByRole('button',{name:'Run private preflight'})).toBeEnabled();
  await page.getByRole('button',{name:'Run private preflight'}).click();
  await expect(page.getByText('SEO metadata is derived from the pinned file set.')).toBeVisible();
  await expect(page.getByText('Source manifest requires seo.title and seo.description.')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Publish unavailable — host proof required'})).toBeDisabled();
  await page.goto(editorPath);
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.getByRole('heading', {name: 'Continue on a larger screen.'})).toBeVisible();
  await expect(page.getByRole('button', {name:'Save draft'})).toHaveCount(0);
  await capture('52_DEVICE_REQUIREMENTS_BROWSER');
  const touch = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: {width:960, height:540},
    isMobile:true, hasTouch:true,
    // Authenticate the same owner independently. Cloning storageState copies
    // the desktop refresh credential into a non-coordinating browser context.
    // Token rotation could otherwise invalidate the desktop session mid-journey.
    permissions:['clipboard-read','clipboard-write']
  });
  try {
    const phone=await touch.newPage();
    await signIn(phone,owner);
    await phone.goto(editorPath);
    await expect(phone.getByRole('heading',{name:'Continue on a larger screen.'})).toBeVisible();
    await expect(phone.getByRole('button',{name:'Save draft'})).toHaveCount(0);
    expect(await phone.evaluate(()=>matchMedia('(min-width: 900px) and (pointer: coarse)').matches)).toBe(true);
    const privateLink=new URL(editorPath,phone.url()).href;
    await expect(phone.getByRole('textbox',{name:'Private continuation link'})).toHaveValue(privateLink);
    await phone.getByRole('button',{name:'Copy continuation link'}).click();
    await expect(phone.getByRole('region',{name:'Continue on a larger screen.'}).getByRole('status'))
      .toHaveText('Private workspace link copied.');
    expect(await phone.evaluate(()=>navigator.clipboard.readText())).toBe(privateLink);
    await phone.getByRole('link',{name:'View saved portfolio'}).click();
    await expect(phone).toHaveURL(editorPath.replace('/edit','/preview/fullscreen'));
    await expect(phone.locator('.ws-studio-editor')).toHaveCount(0);
    await expect(phone.getByRole('main',{name:'Saved private portfolio author preview'})).toBeVisible();
    await phone.goto('/app/portfolios/new');
    await expect(phone.getByRole('heading',{name:'Continue on a larger screen.'})).toBeVisible();
    await expect(phone.getByRole('button',{name:'Choose template and create draft'})).toHaveCount(0);
  } finally {
    await touch.close();
  }
  await page.setViewportSize({width: 1600, height: 1000});
  await navigateVerified('/app/settings','Settings');
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
  await expect(page.getByRole('group',{name:'Confirm other-session sign-out'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('group',{name:'Confirm other-session sign-out'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Sign out other sessions'})).toBeFocused();
  await page.getByRole('button',{name:'Sign out other sessions'}).click();
  await page.getByRole('button',{name:'Confirm sign out other sessions'}).click();
  await expect(page.getByRole('status')).toHaveText('Other sessions were signed out.');
  await capture('44_SECURITY_BROWSER');

  await page.goto('/app/trash');
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  await capture('45_TRASH_BROWSER');
  await page.goto(projectPath);
  const trashTrigger=page.getByRole('button',{name:'Move to Trash'});
  await trashTrigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trashTrigger).toBeFocused();
  await trashTrigger.click();
  await page.getByRole('button',{name:'Confirm move to Trash'}).click();
  await expect(page).toHaveURL('/app/trash');
  await expect(page.getByText('Restore by')).toBeVisible();
  await page.getByRole('button',{name:'Restore privately'}).click();
  await expect(page.getByText('Item restored as private.')).toBeVisible();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  await page.goto(projectPath);
  await expect(page.getByRole('button',{name:'Move to Trash'})).toBeVisible();

  await page.goto('/app/export');
  await page.getByLabel('Portfolio to export').selectOption(editorPath.split('/')[3]!);
  const sourceDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download portfolio source ZIP'}).click();
  const sourceArchive=await sourceDownload;
  expect(sourceArchive.suggestedFilename()).toMatch(/^kadmeion-portfolio-revision-\d+\.zip$/);
  const portable=importPortfolioSourceZip(new Uint8Array(await readFile((await sourceArchive.path())!)));
  expect(portable.files['pages/home.page.json']).toBeTruthy();
  expect(Object.values(portable.files).some(text=>text.includes('Saved author portfolio'))).toBe(true);
  await expect(page.getByText('Portfolio source download prepared.')).toBeVisible();
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
    // F4 owner-only routes must deny direct cross-tenant navigation, not merely
    // hide editor links. No frozen source, reviewer registration or SEO metadata
    // may render before the owner-scoped record authorizes the portfolio.
    for(const mode of ['staging','publish','releases','share'] as const) {
      await other.goto(editorPath.replace('/edit','/'+mode));
      await expect(other.getByRole('alert')).toContainText('Portfolio unavailable.');
      await expect(other.locator('.ws-release-visual-canvas,.ws-release-preflight-gates')).toHaveCount(0);
      await expect(other.getByRole('button',{name:'Run private preflight'})).toHaveCount(0);
      await expect(other.getByRole('button',{name:'Register private reviewer grant'})).toHaveCount(0);
      await expect(other.getByText('Saved author portfolio',{exact:true})).toHaveCount(0);
    }
  } finally {
    await foreign.close();
  }
});

test('verified local operator can read case-scoped views without impersonation or public release',async({page,browser},testInfo)=>{
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
  await auditAccessibility(page,'48_OPERATOR_USERS',dir);
  if(dir){await mkdir(dir,{recursive:true});await page.screenshot({
    path:dir+'/48_ADMIN_USERS_BROWSER.png',animations:'disabled'
  });}
  await page.goto('/app/operations/moderation');
  await expect(page.getByRole('heading',{name:'Portfolio moderation',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Submitted portfolio reports'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Private moderation hold'})).toBeVisible();
  await expect(page.getByText('No pending abuse reports were returned.')).toBeVisible();
  await auditAccessibility(page,'49_OPERATOR_MODERATION',dir);
  if(dir)await page.screenshot({path:dir+'/49_PORTFOLIO_MODERATION_BROWSER.png',animations:'disabled'});
  await page.goto('/app/operations/appeals');
  await expect(page.getByRole('heading',{name:'Appeals & case history',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Internal hold release'})).toBeVisible();
  await expect(page.getByText('No pending appeals were returned.')).toBeVisible();
  await auditAccessibility(page,'50_OPERATOR_APPEALS',dir);
  if(dir)await page.screenshot({path:dir+'/50_APPEALS_BROWSER.png',animations:'disabled'});
  // An administrator's private-case permissions are not public host authority.
  await expect(page.getByText('This does not republish content.',{exact:false})).toBeVisible();

  const ownerContext=await browser.newContext({baseURL:testInfo.project.use.baseURL});
  try {
    const ownerPage=await ownerContext.newPage();
    await signIn(ownerPage,subject);
    await ownerPage.goto('/app/settings/privacy');
    await ownerPage.getByRole('link',{name:'Your cases and appeals'}).click();
    const [caseId]=await ownerPage.getByLabel('Case to review').selectOption({index:1});
    expect(caseId).toBeTruthy();
    await expect(ownerPage.getByText(rationale).first()).toBeVisible();
    const statement='Please review the original case within this isolated owner appeal fixture.';
    await ownerPage.getByLabel('Appeal statement').fill(statement);
    await ownerPage.getByRole('button',{name:'Submit private appeal'}).click();
    await expect(ownerPage.getByText('Private appeal submitted for review.')).toBeVisible();
    await expect(ownerPage.getByRole('heading',{name:'Appeal pending'})).toBeVisible();
    const apiKey=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if(!apiKey) throw new Error('Local publishable key is unavailable.');
    const login=await ownerPage.request.post(origin+'/auth/v1/token?grant_type=password',{
      headers:{apikey:apiKey},data:{email:subject.email,password:subject.password}
    });
    expect(login.ok()).toBe(true);
    const {access_token:ownerToken}=await login.json();
    const denied=await ownerPage.request.post(origin+'/rest/v1/rpc/operator_read_appeal_evidence',{
      headers:{apikey:apiKey,Authorization:'Bearer '+ownerToken},data:{p_case_id:caseId}
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).message).toBe('OPERATOR_REQUIRED');
    await ownerPage.goto('/app/operations/appeals');
    await expect(ownerPage.getByRole('heading',{name:'Restricted operations.'})).toBeVisible();

    await page.reload();
    await page.getByRole('button',{name:'Select for decision'}).click();
    await expect(page.getByText(statement)).toBeVisible();
    await auditAccessibility(page,'50_VERIFIED_APPEAL_EVIDENCE',dir);
    await expect(page.getByText(rationale)).toBeVisible();
    const decision='Closed after reviewing the simulated evidence and the owner appeal statement.';
    await page.getByLabel('Decision rationale').fill(decision);
    await page.getByLabel('Close only the selected audited case.').check();
    await page.getByRole('button',{name:'Record case decision'}).click();
    await expect(page.getByText('Case closed with an audit decision.',{exact:false})).toBeVisible();
    await ownerPage.goto('/app/settings/cases');
    await ownerPage.getByLabel('Case to review').selectOption({index:1});
    await expect(ownerPage.getByRole('heading',{name:'Closed'})).toBeVisible();
    await expect(ownerPage.getByText(decision)).toBeVisible();
    await expect(ownerPage.getByRole('button',{name:'Submit private appeal'})).toHaveCount(0);
  } finally {
    await ownerContext.close();
  }
});

test('F6 owner Growth 35–40 remains private and reflows in dark and light',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires ephemeral owner-JWT Supabase.');
  test.setTimeout(120_000);
  const user=await localUser('CI F6 Growth');
  await page.setViewportSize({width:1600,height:900});
  await signIn(page,user);
  await page.goto('/app/growth');
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  const stages=[
    ['/app/growth','Growth overview','35_GROWTH'],
    ['/app/growth/activity','Developer activity','36_ACTIVITY'],
    ['/app/growth/devscore','Private DevScore','37_DEVSCORE'],
    ['/app/growth/goals','Your goals','38_GOALS'],
    ['/app/analytics','Portfolio analytics','39_ANALYTICS'],
    ['/app/integrations','Platform connections','40_CONNECTIONS']
  ] as const;
  const dir=process.env.KADMEION_BROWSER_CAPTURE_DIR;
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    for(const [route,heading,label] of stages){
      await page.goto(route);
      await expect(page.getByRole('heading',{name:heading,level:1})).toBeVisible();
      await expect(page.getByRole('navigation',{name:'Growth sections'})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
      const dimensions=await page.evaluate(()=>({
        viewport:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth
      }));
      expect(dimensions.scroll,route+' dark '+width+'px')
        .toBeLessThanOrEqual(dimensions.viewport+2);
      if(route==='/app/growth/devscore')
        await expect(page.getByText('A numeric DevScore is unavailable.')).toBeVisible();
      if(route==='/app/analytics')
        await expect(page.getByRole('button',{name:'Enable portfolio analytics'})).toBeDisabled();
      if(dir&&width===390){
        await mkdir(dir,{recursive:true});
        await page.screenshot({path:dir+'/'+label+'_DARK_PHONE_BROWSER.png',animations:'disabled'});
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('/app/growth');
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  for(const [route,heading,label] of stages){
    await page.goto(route);
    await expect(page.getByRole('heading',{name:heading,level:1})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    const dimensions=await page.evaluate(()=>({
      viewport:document.documentElement.clientWidth,
      scroll:document.documentElement.scrollWidth
    }));
    expect(dimensions.scroll,route+' light 390px')
      .toBeLessThanOrEqual(dimensions.viewport+2);
    if(dir){
      await mkdir(dir,{recursive:true});
      await page.screenshot({path:dir+'/'+label+'_LIGHT_PHONE_BROWSER.png',animations:'disabled'});
    }
  }
});

test('F6 restricted operations 48–50 reflow without leaking account directory',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires isolated privileged operator fixture.');
  test.setTimeout(100_000);
  const operator=await localUser('CI F6 Moderator');
  grantLocalOperatorRole(operator.id);
  await page.setViewportSize({width:1600,height:900});
  await signIn(page,operator);
  await page.goto('/app/operations/users');
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  const stages=[
    ['/app/operations/users','Admin users','48_ADMIN_USERS'],
    ['/app/operations/moderation','Portfolio moderation','49_MODERATION'],
    ['/app/operations/appeals','Appeals & case history','50_APPEALS']
  ] as const;
  const dir=process.env.KADMEION_BROWSER_CAPTURE_DIR;
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    for(const [route,heading,label] of stages){
      await page.goto(route);
      await expect(page.getByRole('heading',{name:heading,level:1})).toBeVisible();
      await expect(page.getByRole('navigation',{name:'Restricted operation areas'})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
      const dimensions=await page.evaluate(()=>({
        viewport:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth
      }));
      expect(dimensions.scroll,route+' dark '+width+'px')
        .toBeLessThanOrEqual(dimensions.viewport+2);
      if(dir&&width===390){
        await mkdir(dir,{recursive:true});
        await page.screenshot({path:dir+'/'+label+'_DARK_PHONE_BROWSER.png',animations:'disabled'});
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('/app/operations/users');
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  for(const [route,heading,label] of stages){
    await page.goto(route);
    await expect(page.getByRole('heading',{name:heading,level:1})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    const dimensions=await page.evaluate(()=>({
      viewport:document.documentElement.clientWidth,
      scroll:document.documentElement.scrollWidth
    }));
    expect(dimensions.scroll,route+' light 390px')
      .toBeLessThanOrEqual(dimensions.viewport+2);
    if(dir){
      await mkdir(dir,{recursive:true});
      await page.screenshot({path:dir+'/'+label+'_LIGHT_PHONE_BROWSER.png',animations:'disabled'});
    }
  }
});

test('F1 recovery request and password reset use isolated GoTrue and Mailpit', async ({ page, browser }) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1', 'Requires the isolated Supabase CI job.');
  test.setTimeout(60_000);
  const user = await localUser('CI Recovery');
  const directory = process.env.KADMEION_BROWSER_CAPTURE_DIR;
  async function capture(screen: string) {
    await auditAccessibility(page,screen,directory);
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
  // Replay only the original one-time provider link, not an issued session JWT.
  const replay=await fetch(verification,{redirect:'manual'});
  const replayTarget=URL.parse(replay.headers.get('location')??'');
  expect(replay.status>=400||([302,303].includes(replay.status)&&!!replayTarget&&
    !new URLSearchParams(replayTarget.hash.slice(1)).has('access_token'))).toBe(true);
  const fresh=await browser.newPage();
  try{
    await fresh.goto(new URL('/signin',page.url()).href);
    await fresh.getByLabel('Email address').fill(user.email);
    await fresh.locator('#signin-password').fill(user.password);
    await fresh.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(fresh.getByRole('alert')).toContainText('Incorrect credentials or sign-in unavailable.');
    await expect(fresh.getByRole('link',{name:'Open private workspace'})).toHaveCount(0);
    await fresh.goto(new URL('/app',page.url()).href);
    await expect(fresh.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
    await expect(fresh.locator('.ws-shell')).toHaveCount(0);
  }finally{await fresh.close();}
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

test('eligible private static ZIP and expired Trash remain owner scoped',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires isolated Supabase and GoTrue.');
  test.setTimeout(85_000);
  const owner=await localUser('F05 private archive owner');
  await signIn(page,owner);
  await page.setViewportSize({width:1600,height:1000});
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Blank',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('Offline portfolio fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'Offline portfolio fixture',level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  const portfolioId=editorPath.split('/')[3]!;

  await page.getByRole('button',{name:'Sections',exact:true}).click();
  await page.getByLabel('Section layout').selectOption('stepped-hero@1');
  await page.getByRole('button',{name:'Add section',exact:true}).click();
  await page.getByRole('button',{name:/^New section: title/}).click();
  await page.getByRole('button',{name:'Choose compatible component'}).click();
  await page.getByRole('button',{name:/Heading title-stacked@1/}).click();
  await page.getByRole('button',{name:'Add to empty slot'}).click();
  await page.getByLabel('Text content').fill('Private archive example');
  await page.getByRole('button',{name:'Apply text'}).click();
  await page.getByRole('button',{name:'Metadata',exact:true}).click();
  await page.getByLabel('SEO page title').fill('Offline portfolio');
  await page.getByLabel('SEO description').fill('A saved portfolio rendered as an offline private preview.');
  await page.getByRole('button',{name:'Apply SEO metadata to draft'}).click();
  await page.getByRole('button',{name:'Save draft'}).click();
  await expect(page.getByText('Private portfolio draft saved.')).toBeVisible();

  await page.goto('/app/export');
  await page.getByLabel('Portfolio to export').selectOption(portfolioId);
  await page.getByRole('link',{name:'Open preflight for selected portfolio'}).click();
  await expect(page).toHaveURL(editorPath.replace('/edit','/publish'));
  await page.getByRole('button',{name:'Run private preflight'}).click();
  const archiveButton=page.getByRole('button',{name:'Download offline static preview ZIP'});
  await expect(archiveButton).toBeEnabled();
  const [archive]=await Promise.all([page.waitForEvent('download'),archiveButton.click()]);
  const path=await archive.path();
  expect(path).toBeTruthy();
  const files=readStrictStoredZip(new Uint8Array(await readFile(path!)),{
    maxEntries:3,maxBytes:1024*1024,maxEntryBytes:750000
  });
  expect([...files.keys()].sort()).toEqual(['README.txt','index.html','kadmeion-static-preview.json']);
  const html=files.get('index.html')!;
  const manifest=JSON.parse(new TextDecoder().decode(files.get('kadmeion-static-preview.json')));
  expect(manifest).toMatchObject({previewOnly:true,publicUrl:null,
    files:[{path:'index.html',bytes:html.length,sha256:createHash('sha256').update(html).digest('hex')}]});
  const markup=new TextDecoder().decode(html);
  expect(markup).toContain('<h1>Private archive example</h1>');
  expect(markup).toContain('noindex,nofollow,noarchive');
  expect(markup).not.toContain('<script');
  await expect(page.getByRole('button',{name:'Publish unavailable — host proof required'})).toBeDisabled();

  await page.goto('/app/portfolios');
  await page.getByRole('listitem').filter({hasText:'Offline portfolio fixture'})
    .getByRole('button',{name:'Move to Trash'}).click();
  await page.getByRole('button',{name:'Confirm move to Trash'}).click();
  await expect(page).toHaveURL('/app/trash');
  const restore=page.getByRole('button',{name:'Restore privately'});
  await expect(restore).toBeEnabled();
  // Age only this disposable owner's journal and matching record while the
  // browser displays the previous deadline. The actual owner RPC rejects it.
  const changed=runLocalFixtureSql(`
    with journal as (
      update public.private_trash_items
      set trashed_at=statement_timestamp()-interval '16 days',
          restore_until=statement_timestamp()-interval '1 day'
      where owner_user_id=:'actor_id'::uuid and item_id=:'item_id'::uuid
        and item_type='portfolio' and restored_at is null
      returning item_id,trashed_at
    ), portfolio as (
      update public.portfolios item set trashed_at=journal.trashed_at
      from journal where item.id=journal.item_id and item.owner_user_id=:'actor_id'::uuid
      returning item.id
    )
    select count(*) from portfolio;
  `,owner.id,portfolioId);
  expect(changed).toBe('1');
  await restore.click();
  await expect(page.getByRole('alert')).toContainText('15-day restoration window has ended');
  await expect(restore).toBeDisabled();
  await page.reload();
  await expect(page.getByText('Recovery window ended. Restore is unavailable.')).toBeVisible();
  await expect(restore).toBeDisabled();
  await expect(page.getByRole('button',{name:/permanent/i})).toHaveCount(0);
});


test('F6 failed onboarding skip remains private and is retryable after RPC recovery', async ({page}) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1',
    'Requires isolated local Supabase and disposable GoTrue owner.');
  test.setTimeout(75_000);
  const owner = await localUser('F6 onboarding retry fixture');
  await signIn(page, owner);
  await page.goto('/app/onboarding');

  const skip = page.getByRole('button', {name: 'Skip selected step'});
  const portfolio = page.getByRole('radio', {name: /Create a portfolio/});
  await expect(portfolio).toBeChecked();
  await expect(page.getByText('Skipped in your private account')).toHaveCount(0);

  // Fail the actual owner RPC rather than substituting a successful mock.
  // The UI must not commit a skipped state until the server confirms it.
  const rpc = '**/rest/v1/rpc/set_private_onboarding_step*';
  await page.route(rpc, route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({code: 'PGRST503', message: 'Disposable test outage'})
  }));
  await skip.click();
  await expect(page.getByRole('status')).toContainText(
    'The server did not confirm this skipped step. Nothing was marked saved.');
  await expect(skip).toBeEnabled();
  await expect(page.getByText('Skipped in your private account')).toHaveCount(0);
  await page.unroute(rpc);

  // An unsaved optimistic state must not survive a fresh authenticated read.
  await page.reload();
  await expect(portfolio).toBeChecked();
  await expect(page.getByText('Skipped in your private account')).toHaveCount(0);
  await skip.click();
  await expect(page.getByRole('status')).toContainText('saved as skipped');
  await page.reload();
  await expect(page.getByText('Skipped in your private account')).toHaveCount(1);
});


test('S6 S2 project list 503 retries, create conflict preserves fields and private navigation works', async ({page}) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1', 'Disposable local Supabase only.');
  test.setTimeout(90_000);
  const owner=await localUser('S6 S2 retry');
  await signIn(page,owner);
  // Establish a real successful owner list first. The forced failure must
  // be tied to one explicit reload, not incidental startup requests.
  await page.goto('/app/projects');
  await expect(page.getByRole('heading',{name:'Your first project belongs here.'})).toBeVisible();
  let readFailed=false, failRead=true, createFailed=false;
  const requests:{method:string;status:number}[]=[];
  await page.route('**/rest/v1/projects?*',async route=>{
    const method=route.request().method();
    if(method==='GET'&&failRead) {
      if(!readFailed) requests.push({method,status:503});
      readFailed=true;
      await route.fulfill({status:503,contentType:'application/json',
        body:JSON.stringify({message:'Disposable list outage'})});
    } else if(method==='POST'&&!createFailed) {
      createFailed=true;requests.push({method,status:409});
      await route.fulfill({status:409,contentType:'application/json',
        body:JSON.stringify({code:'23505',message:'Disposable conflict'})});
    } else await route.continue();
  });
  await page.reload();
  await expect.poll(()=>readFailed).toBe(true);
  await expect(page.getByRole('alert')).toContainText('Private workspace request failed.');
  await expect(page.getByText('Your first project belongs here.')).toHaveCount(0);
  failRead=false;
  await page.getByRole('button',{name:'Retry securely'}).click();
  await expect(page.getByRole('heading',{name:'Your first project belongs here.'})).toBeVisible();
  const opener=page.getByRole('button',{name:'Add first project'});
  await opener.click();
  const drawer=page.getByRole('dialog',{name:'Add a project'});
  await drawer.getByLabel('Project title').fill('S6 navigation retry fixture');
  await drawer.getByLabel('Summary (optional)').fill('Preserve this private form on conflict');
  await drawer.getByRole('button',{name:'Save project'}).click();
  await expect(drawer.getByRole('alert')).toContainText('Choose a different slug');
  await expect(drawer.getByLabel('Project title')).toHaveValue('S6 navigation retry fixture');
  await expect(drawer.getByLabel('Summary (optional)')).toHaveValue('Preserve this private form on conflict');
  await expect(drawer).toBeVisible();
  // S2 uncertainty fence: a 409 is not permission for an immediate second insert.
  await expect(drawer.getByRole('button',{name:'Save project'})).toBeDisabled();
  await drawer.getByRole('button',{name:'Check saved project before retry'}).click();
  await expect(drawer.getByRole('alert')).toContainText('No matching saved project was found');
  await expect(drawer.getByLabel('Project title')).toHaveValue('S6 navigation retry fixture');
  await expect(drawer.getByRole('button',{name:'Save project'})).toBeEnabled();
  await drawer.getByRole('button',{name:'Save project'}).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('status').filter({hasText:'Saved privately in your account.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'S6 navigation retry fixture'})).toBeVisible();
  await page.getByRole('link',{name:'S6 navigation retry fixture'}).click();
  await expect(page.getByRole('heading',{name:'Build the case study.'})).toBeVisible();
  await expect(page.getByLabel('Project title')).toHaveValue('S6 navigation retry fixture');
  await page.getByRole('link',{name:'Back to project library'}).click();
  await expect(page.getByRole('heading',{name:'Project library.'})).toBeVisible();
  expect(requests).toEqual([{method:'GET',status:503},{method:'POST',status:409}]);
});

test('S6 S4 freeze retry preserves idempotency key and guards the exact frozen pin', async ({page}) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1', 'Disposable local Supabase only.');
  test.setTimeout(120_000);
  const owner=await localUser('S6 S4 freeze retry');
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('S6 frozen request fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'S6 frozen request fixture',level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  await page.goto(editorPath.replace('/edit','/staging'));
  await expect(page.getByLabel('Saved revision')).toBeEnabled();
  const freeze=page.getByRole('button',{name:'Freeze private revision'});
  const operations:string[]=[];
  let firstFreeze=true,failedPin=true;
  await page.route('**/rest/v1/rpc/freeze_private_release_request',async route=>{
    const args=route.request().postDataJSON() as {p_operation_id?:string};
    expect(args.p_operation_id).toMatch(/^[0-9a-f-]{36}$/i);
    operations.push(args.p_operation_id!);
    if(firstFreeze){
      firstFreeze=false;
      await route.fulfill({status:503,contentType:'application/json',
        body:JSON.stringify({message:'Disposable freeze acknowledgement loss'})});
    }else await route.continue();
  });
  await page.route('**/rest/v1/rpc/load_private_frozen_revision',async route=>{
    if(failedPin){
      failedPin=false;
      await route.fulfill({status:503,contentType:'application/json',
        body:JSON.stringify({message:'Disposable pinned read outage'})});
    }else await route.continue();
  });
  await freeze.click();
  await expect(page.getByRole('alert')).toContainText('Freeze could not be confirmed');
  await expect(freeze).toBeEnabled();
  await freeze.click();
  await expect(page.getByText(/Private revision \d+ frozen\./)).toBeVisible();
  expect(operations).toHaveLength(2);
  expect(operations[0]).toBe(operations[1]);
  await expect(page.getByRole('alert')).toContainText('The exact frozen revision could not be verified.');
  await expect(page.getByText(/Current saved draft · Not yet frozen/)).toHaveCount(0);
  await expect(page.locator('.ws-release-visual-canvas')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Copy public link unavailable'})).toBeDisabled();
  await expect(page.getByRole('button',{name:/Register.*reviewer/i})).toBeDisabled();
  // Only the S4 pin-retry candidate exposes this control. A first failed
  // attested pin may be retried without changing frozen request/operation ID.
  {
    const retryPin=page.getByRole('button',{name:'Retry exact frozen revision'});
    await expect(retryPin).toBeEnabled();
    await retryPin.click();
    await expect(page.locator('.ws-release-visual-canvas')).toBeVisible();
    await expect(page.getByRole('button',{name:'Register private reviewer grant'})).toBeEnabled();
    await expect(page.getByRole('button',{name:'Copy public link unavailable'})).toBeDisabled();
    expect(operations).toHaveLength(2);
  }
  await page.unroute('**/rest/v1/rpc/load_private_frozen_revision');
  await page.unroute('**/rest/v1/rpc/freeze_private_release_request');
});


test('S6 S3 pending inspector and SEO buffers block Restore until resolved', async ({page}) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1',
    'Requires S3 integrated editor and disposable local Supabase.');
  test.setTimeout(110_000);
  const owner=await localUser('S6 S3 checkpoint buffers');
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('S6 checkpoint buffer fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'S6 checkpoint buffer fixture',level:1})).toBeVisible();

  const textField=page.getByLabel('Text content');
  await expect(textField).toBeVisible();
  await textField.fill('Unsaved S3 primary text must survive History');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.getByRole('button',{name:/Revision 1/}).click();
  const restore=page.getByRole('button',{name:'Restore selected checkpoint to draft'});
  await expect(restore).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Apply or discard unapplied inspector and source text');
  await page.getByRole('button',{name:'Back to editor canvas'}).click();
  await expect(textField).toHaveValue('Unsaved S3 primary text must survive History');
  await page.getByRole('button',{name:'Discard unapplied text'}).click();
  await page.getByRole('button',{name:'Metadata',exact:true}).click();
  const storedSeoTitle=await page.getByLabel('SEO page title').inputValue();
  await page.getByLabel('SEO page title').fill('Unapplied S3 SEO title');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await expect(restore).toBeDisabled();
  await page.getByRole('button',{name:'Back to editor canvas'}).click();
  await page.getByRole('button',{name:'Metadata',exact:true}).click();
  await expect(page.getByLabel('SEO page title')).toHaveValue('Unapplied S3 SEO title');

  // Return the buffered SEO field to its exact last-saved value. The global
  // reload/discard action is error-only, not a general pending-input control.
  await page.getByLabel('SEO page title').fill(storedSeoTitle);
  await expect(page.getByLabel('SEO page title')).not.toHaveValue('Unapplied S3 SEO title');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.getByRole('button',{name:/Revision 1/}).click();
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(page.getByText('Revision restored into the working draft. Save to keep it.')).toBeVisible();
  await page.getByRole('button',{name:'Back to editor canvas'}).click();
  await page.getByRole('button',{name:'Save draft'}).click();
  await expect(page.getByText('Private portfolio draft saved.')).toBeVisible();
});

test('S6 S5 principal A to B switch clears restricted views in the same browser', async ({page}) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1','Requires disposable local Supabase.');
  test.setTimeout(95_000);
  const [operator,owner]=await Promise.all([
    localUser('S6 restricted operator A'),localUser('S6 private owner B')
  ]);
  grantLocalOperatorRole(operator.id);
  await signIn(page,operator);
  await page.goto('/app/operations/users');
  await expect(page.getByRole('heading',{name:'Admin users'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Restricted operation areas'})).toBeVisible();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(page,owner);
  await page.goto('/app/operations/users');
  await expect(page.getByRole('heading',{name:'Restricted operations.'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Restricted operation areas'})).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('did not authorize this session');
  await page.goto('/app/settings');
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  await expect(page.getByText(operator.email,{exact:true})).toHaveCount(0);
  await page.goto('/app/settings/security');
  await expect(page.getByRole('heading',{name:'Account security'})).toBeVisible();
  await expect(page.getByText(operator.email,{exact:true})).toHaveCount(0);
});


test('S6 real 135 owner projects preserve microsecond-tie keyset ordering and owner scope',async()=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable loopback GoTrue/PostgREST only.');
  test.setTimeout(105_000);
  const owner=await localUser('S6 real 135 owner projects');
  const other=await localUser('S6 paged outsider');
  const inserted=runLocalFixtureSql(
    "with batch as (insert into public.projects(owner_user_id,slug,title,summary,description,updated_at) " +
    "select :'actor_id'::uuid,'s6-paged-'||lpad(n::text,3,'0')," +
    "'S6 project '||lpad(n::text,3,'0'),'',''," +
    "case when n<=70 then '2026-11-16T00:00:00.123457+00:00'::timestamptz " +
    "else '2026-11-16T00:00:00.123456+00:00'::timestamptz end " +
    "from generate_series(1,135) n returning id) select count(*) from batch;",owner.id);
  expect(inserted).toBe('135');
  const ids=runLocalFixtureSql(
    "select string_agg(id::text,',' order by updated_at desc,id asc) " +
    "from public.projects where owner_user_id=:'actor_id'::uuid;",owner.id).split(',');
  expect(ids).toHaveLength(135);
  function makePort(){
    const items=new Map<string,string>();
    const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if(!key)throw new Error('Local Supabase publishable key missing.');
    return new SupabaseBrowserAuthPort({supabaseUrl:origin,
      publishableKey:key,appOrigin:'http://127.0.0.1:4173',
      storage:{
        getItem:k=>items.get(k)??null,
        setItem:(k,v)=>{items.set(k,v);},
        removeItem:k=>{items.delete(k);}
      }});
  }
  const port=makePort();
  const signInResult=await port.signInWithPassword({email:owner.email,password:owner.password});
  expect(signInResult.error).toBeNull();
  expect(signInResult.data?.session?.user.id).toBe(owner.id);
  const accumulated:string[]=[];
  let cursor:OwnerPrivateCursorV1|null=null;
  for(const expectedLength of [50,50,35]){
    const result=await port.listOwnerProjectsPage(50,cursor);
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data!.items).toHaveLength(expectedLength);
    accumulated.push(...result.data!.items.map(item=>item.id));
    const next=result.data!.nextCursor;
    if(expectedLength===35)expect(next).toBeNull();
    else{
      expect(next).toMatchObject({version:1,collection:'projects',ownerUserId:owner.id,
        id:result.data!.items.at(-1)!.id});
      expect(next!.updatedAt).toMatch(/\.12345[67]/);
    }
    cursor=next;
  }
  expect(accumulated).toEqual(ids);
  expect(new Set(accumulated).size).toBe(135);
  expect((await port.listOwnerProjectsPage(51)).data).toBeNull();
  const otherPort=makePort();
  expect((await otherPort.signInWithPassword({email:other.email,password:other.password})).error).toBeNull();
  const foreignCursor:OwnerPrivateCursorV1={version:1,collection:'projects',
    ownerUserId:owner.id,updatedAt:'2026-11-16T00:00:00.123457+00:00',id:ids[49]!};
  const denied=await otherPort.listOwnerProjectsPage(50,foreignCursor);
  expect(denied.data).toBeNull();
  expect(denied.error?.message).toMatch(/cursor.*current owner/i);
  const empty=await otherPort.listOwnerProjectsPage(50,null);
  expect(empty.error).toBeNull();
  expect(empty.data?.items).toEqual([]);
});

test('S6 S2 integrated paginates 135 projects and retries a 429 without losing pages',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1',
    'Requires integrated S1+S2 and isolated owner service.');
  test.setTimeout(115_000);
  const owner=await localUser('S6 S2 paged browser');
  expect(runLocalFixtureSql(
    "with batch as (insert into public.projects(owner_user_id,slug,title,summary,description,updated_at) " +
    "select :'actor_id'::uuid,'s6-paged-'||lpad(n::text,3,'0')," +
    "'S6 project '||lpad(n::text,3,'0'),'',''," +
    "case when n<=70 then '2026-11-16T00:00:00.123457+00:00'::timestamptz " +
    "else '2026-11-16T00:00:00.123456+00:00'::timestamptz end " +
    "from generate_series(1,135) n returning id) select count(*) from batch;",owner.id)
  ).toBe('135');
  const deepTitle=runLocalFixtureSql(
    "select title from public.projects where owner_user_id=:'actor_id'::uuid " +
    "order by updated_at desc,id asc limit 1 offset 120;",owner.id);
  await signIn(page,owner);
  await page.goto('/app/projects');
  const count=page.locator('.ws-project-count');
  await expect(count).toContainText('50 loaded private projects');
  const search=page.getByLabel('Search private projects');
  await search.fill(deepTitle);
  await expect(page.getByRole('link',{name:deepTitle,exact:true})).toHaveCount(0);
  await expect(count).toContainText('Search and sorting apply only to loaded records');
  await search.fill('');
  const more=page.getByRole('button',{name:'Load more projects'});
  let injected429=false;
  await page.route('**/rest/v1/projects?*',async route=>{
    const url=new URL(route.request().url());
    if(!injected429&&route.request().method()==='GET'&&url.searchParams.has('or')){
      injected429=true;
      await route.fulfill({status:429,contentType:'application/json',
        body:JSON.stringify({message:'Disposable next-page rate limit'})});
    }else await route.continue();
  });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Too many private workspace requests');
  await expect(count).toContainText('50 loaded private projects');
  const retryPage=page.getByRole('button',{name:'Retry loading more projects'});
  await retryPage.focus();
  await page.keyboard.press('Enter');
  await expect(count).toContainText('100 loaded private projects');
  expect(injected429).toBe(true);
  await more.click();
  await expect(count).toContainText('135 loaded private projects');
  await expect(more).toHaveCount(0);
  await search.fill(deepTitle);
  await expect(page.getByRole('link',{name:deepTitle,exact:true})).toBeVisible();
  await search.fill('');
  expect(await page.locator('.ws-project-card').count()).toBe(135);
});

test('S6 S3 candidate paginates 111 owner portfolios with truthful partial search',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1',
    'Requires S1+S3 integrated cursor consumer and disposable local Supabase.');
  test.setTimeout(115_000);
  const owner=await localUser('S6 S3 portfolio paging');
  expect(runLocalFixtureSql(
    "with batch as (insert into public.portfolios(owner_user_id,slug,title,template_id,updated_at) " +
    "select :'actor_id'::uuid,'s6-folio-'||lpad(n::text,3,'0')," +
    "'S6 portfolio '||lpad(n::text,3,'0'),'arc'," +
    "case when n<=70 then '2026-11-16T00:00:00.123457+00:00'::timestamptz " +
    "else '2026-11-16T00:00:00.123456+00:00'::timestamptz end " +
    "from generate_series(1,111) n returning id) select count(*) from batch;",owner.id)
  ).toBe('111');
  const deepTitle=runLocalFixtureSql(
    "select title from public.portfolios where owner_user_id=:'actor_id'::uuid " +
    "order by updated_at desc,id asc limit 1 offset 105;",owner.id);
  await signIn(page,owner);
  await page.goto('/app/portfolios');
  const more=page.getByRole('button',{name:'Load more portfolios'});
  await expect(page.getByText('50 portfolio records loaded.',{exact:false})).toBeVisible();
  await page.getByLabel('Find a portfolio').fill(deepTitle);
  await expect(page.getByRole('link',{name:deepTitle,exact:true})).toHaveCount(0);
  await page.getByLabel('Find a portfolio').fill('');
  await more.click();
  await expect(page.getByText('100 portfolio records loaded.',{exact:false})).toBeVisible();
  await more.click();
  await expect(page.getByText('111 portfolio records loaded.',{exact:false})).toBeVisible();
  await expect(more).toHaveCount(0);
  await page.getByLabel('Find a portfolio').fill(deepTitle);
  await expect(page.getByRole('link',{name:deepTitle,exact:true})).toBeVisible();
});

test('B16 C01 owner thumbnail actual bytes, lost acknowledgement, stale CAS, replacement and detach', async ({page,browser},testInfo) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1','Disposable local Supabase only.');
  test.setTimeout(150_000);
  const owner=await localUser('C01 thumbnail owner');
  const foreign=await localUser('C01 other owner');
  const title='B16 C01 private fixture';
  const firstAlt='C01 original synthetic cover', replacementAlt='C01 replacement synthetic cover';
  const firstBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQSbn0HwAEJAJK6G06bAAAAABJRU5ErkJggg==','base64');
  await signIn(page,owner);
  await page.goto('/app/projects');
  await page.getByRole('button',{name:'Add first project'}).click();
  const drawer=page.getByRole('dialog',{name:'Add a project'});
  await drawer.getByLabel('Project title').fill(title);
  await drawer.getByRole('button',{name:'Save project'}).click();
  await expect(drawer).toBeHidden();
  let coverRead:{status:number;code:string|null;revision:number|null}|null=null;
  page.on('response',async response=>{
    const u=new URL(response.url());
    if(u.origin!==origin||u.pathname!=='/rest/v1/rpc/read_private_project_thumbnail')return;
    const status=response.status();
    const value:unknown=await response.json().catch(()=>null);
    const row=value&&typeof value==='object'?value as Record<string,unknown>:null;
    coverRead={status,code:typeof row?.code==='string'&&/^[A-Z0-9]{5}$/.test(row.code)?row.code:null,
      revision:typeof row?.revision==='number'&&Number.isSafeInteger(row.revision)?row.revision:null};
  });
  await page.getByRole('link',{name:title}).click();
  await expect(page.getByRole('heading',{name:'Build the case study.'})).toBeVisible();
  const projectPath=new URL(page.url()).pathname;
  const cover=page.getByRole('region',{name:'Project thumbnail'});
  const revision=page.getByRole('complementary',{name:'Saved project preview'}).getByText(/SAVED DRAFT · REVISION \d+/);
  const readRevision=async()=>Number((await revision.innerText()).match(/\d+$/)?.[0]);
  const expectImage=async(alt:string,bytes:Buffer,confirmed=true)=>{
    const image=cover.getByRole('img',{name:alt,exact:true});
    await expect(image).toBeVisible();
    await expect.poll(async()=>image.evaluate(async(element,expected)=>{
      const img=element as HTMLImageElement;
      if(!img.complete||!img.naturalWidth||!img.naturalHeight||!img.src.startsWith('blob:'))return false;
      const response=await fetch(img.src);
      const actual=new Uint8Array(await response.arrayBuffer());
      return response.ok&&response.headers.get('content-type')==='image/png'&&
        actual.length===expected.length&&actual.every((byte,i)=>byte===expected[i]);
    },Array.from(bytes))).toBe(true);
    await expect(cover.getByText('Saved image description: '+alt,{exact:true})).toBeVisible();
    if(confirmed)await expect(cover.getByText('Last verified private cover',{exact:true})).toBeVisible();
  };
  const choose=async(name:string,bytes:Buffer,alt:string)=>{
    const fileInput=cover.getByLabel(/Image file/);
    const altInput=cover.getByLabel('Image alt text');
    // setInputFiles does not wait for enabled; refresh() deliberately ignores
    // upload input changes during the initial verified read/owner check.
    await expect(fileInput).toBeEnabled();
    await expect(altInput).toBeEnabled();
    await fileInput.setInputFiles({name,mimeType:'image/png',buffer:bytes});
    await altInput.fill(alt);
    await expect(altInput).toHaveValue(alt);
  };
  await expect(cover.getByText('Folder cover',{exact:true})).toBeVisible();
  const attach=cover.getByRole('button',{name:'Upload and attach thumbnail'});
  try{
    await choose('first.png',firstBytes,firstAlt);
    await expect(attach).toBeEnabled(); // Required capability: no absent-API skip.
  }catch(error){
    // Failure-only, bounded diagnostic: never save raw response, URL, IDs,
    // credentials, user fields, file names or unclassified alert strings.
    const read=coverRead as {status:number;code:string|null;revision:number|null}|null;
    const saved=await readRevision().catch(()=>NaN);
    const text=(await cover.getByRole('alert').allTextContents().catch(()=>[])).join(' ');
    const category=/owner session changed/i.test(text)?'EPOCH_CHANGED':/access was denied/i.test(text)?'DENIED':
      /could not be verified/i.test(text)?'UNVERIFIED':/private cover read failed/i.test(text)?'READ_FAILED':text?'OTHER':'NONE';
    const fileInput=cover.getByLabel(/Image file/),altInput=cover.getByLabel('Image alt text');
    const dir='/tmp/kadmeion-owner-captures';await mkdir(dir,{recursive:true});
    await writeFile(dir+'/'+randomUUID()+'.route-diagnostics.json',JSON.stringify({
      pathname:'/app/projects/:id',gate:'C01_INITIAL_COVER',readStatus:read?.status??null,sqlstate:read?.code??null,
      revisionRelation:read?.revision==null||!Number.isFinite(saved)?'UNKNOWN':read.revision===saved?'MATCH':read.revision<saved?'OLDER':'NEWER',
      busy:await cover.getByText('Checking or saving the private cover…',{exact:true}).isVisible().catch(()=>false),
      fileInputEnabled:await fileInput.isEnabled().catch(()=>false),
      filePresent:await fileInput.evaluate(node=>!!(node as HTMLInputElement).files?.length).catch(()=>false),
      altMatches:await altInput.inputValue().then(value=>value===firstAlt).catch(()=>false),
      attachEnabled:await attach.isEnabled().catch(()=>false),category
    }),{encoding:'utf8',mode:0o600});
    throw error;
  }
  const base=await readRevision();
  expect(Number.isSafeInteger(base)).toBe(true);
  let uploads=0,registrations=0;
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.origin!==origin||request.method()!=='POST')return;
    if(url.pathname.startsWith('/storage/v1/object/kadmeion-private-assets/'))uploads++;
    if(url.pathname==='/rest/v1/rpc/register_private_project_image')registrations++;
  });
  // Only synthetic operation fields held in memory; never output payload, URL, headers or IDs.
  type AttachInput={p_project_id:string;p_base_revision:number;p_asset_id:string|null;p_operation_id:string};
  const operations:AttachInput[]=[];
  const statuses:number[]=[];
  const conflicts:boolean[]=[];
  let dropFirst=true;
  await page.route('**/rest/v1/rpc/set_private_project_thumbnail',async route=>{
    const data=route.request().postDataJSON() as AttachInput;
    operations.push(data);
    const response=await route.fetch();
    try{
      statuses.push(response.status());
      const errorCode=response.ok()?null:await response.json().then((value:unknown)=>
        !!value&&typeof value==='object'&&'code' in value&&value.code==='40001').catch(()=>false);
      conflicts.push(errorCode===true);
      if(dropFirst&&response.ok()){dropFirst=false;await route.abort('failed');}
      else await route.fulfill({response});
    }finally{await response.dispose();}
  });
  await attach.click();
  await expect(cover.getByRole('alert')).toContainText(/Cover change was not confirmed|Private cover change could not be verified/);
  expect(statuses[0]>=200&&statuses[0]<300).toBe(true);
  expect(uploads).toBe(1);expect(registrations).toBe(1);
  await cover.getByRole('button',{name:'Retry same cover operation'}).click();
  await expectImage(firstAlt,firstBytes);
  expect(operations.length).toBe(2);
  expect(JSON.stringify(operations[0])===JSON.stringify(operations[1])).toBe(true);
  expect(uploads).toBe(1);expect(registrations).toBe(1);
  await expect(revision).toHaveText('SAVED DRAFT · REVISION '+(base+1));
  await page.reload();
  await expectImage(firstAlt,firstBytes);
  await expect(revision).toHaveText('SAVED DRAFT · REVISION '+(base+1));

  // Distinct bytes generated in browser (no third-party network or synthetic server success).
  const replacementBytes=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#31506b';ctx.fillRect(0,0,2,2);
    return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  const other=await page.context().newPage();
  try{
    await other.goto(projectPath);
    await expect(other.getByRole('region',{name:'Project thumbnail'}).getByRole('img',{name:firstAlt})).toBeVisible();
    await other.getByLabel('Short description').fill('C01 concurrent saved summary');
    await other.getByRole('button',{name:'Save changes'}).click();
    await expect(other.getByRole('status').filter({hasText:'Private draft saved.'})).toBeVisible();
    await expect(other.getByRole('complementary',{name:'Saved project preview'}).getByText('SAVED DRAFT · REVISION '+(base+2))).toBeVisible();
    await choose('replacement.png',replacementBytes,replacementAlt);
    await cover.getByRole('button',{name:'Replace thumbnail'}).click();
    await expect(cover.getByRole('alert')).toContainText('Cover change was not confirmed.');
    expect(statuses[2]>=400&&conflicts[2]).toBe(true);
    await expectImage(firstAlt,firstBytes,false);
    await expect(cover.getByRole('img',{name:replacementAlt})).toHaveCount(0);
    // Independently reload the real saved project: failure must not change its cover or revision.
    await other.reload();
    const savedCover=other.getByRole('region',{name:'Project thumbnail'});
    const oldImage=savedCover.getByRole('img',{name:firstAlt,exact:true});
    await expect(oldImage).toBeVisible();
    await expect.poll(()=>oldImage.evaluate(async(element,expected)=>{
      const img=element as HTMLImageElement;
      if(!img.complete||!img.naturalWidth||!img.naturalHeight||!img.src.startsWith('blob:'))return false;
      const response=await fetch(img.src);
      const bytes=new Uint8Array(await response.arrayBuffer());
      return response.ok&&response.headers.get('content-type')==='image/png'&&bytes.length===expected.length&&bytes.every((v,i)=>v===expected[i]);
    },Array.from(firstBytes))).toBe(true);
    await expect(other.getByRole('complementary',{name:'Saved project preview'}).getByText('SAVED DRAFT · REVISION '+(base+2))).toBeVisible();
    await expect(savedCover.getByRole('img',{name:replacementAlt})).toHaveCount(0);
    expect(uploads).toBe(2);expect(registrations).toBe(2);
    await cover.getByRole('button',{name:'Refresh private cover'}).click();
    const reapply=cover.getByRole('button',{name:'Attach registered image to latest revision'});
    await expect(reapply).toBeEnabled();
    await reapply.click();
    await expectImage(replacementAlt,replacementBytes);
    expect(operations.length).toBe(4);
    expect(operations[2].p_asset_id===operations[3].p_asset_id&&
      operations[2].p_operation_id!==operations[3].p_operation_id&&
      operations[3].p_base_revision===operations[2].p_base_revision+1).toBe(true);
    expect(uploads).toBe(2);expect(registrations).toBe(2);
    await page.reload();
    await expectImage(replacementAlt,replacementBytes);
    await expect(revision).toHaveText('SAVED DRAFT · REVISION '+(base+3));
    await expect(page.getByLabel('Short description')).toHaveValue('C01 concurrent saved summary');
    // A distinct principal must be denied while a selected private image still exists.
    const isolated=await browser.newContext({baseURL:testInfo.project.use.baseURL});
    try{
      const visitor=await isolated.newPage();
      await signIn(visitor,foreign);
      await visitor.goto(projectPath);
      await expect(visitor.getByRole('alert')).toContainText('Project unavailable.');
      await expect(visitor.getByRole('region',{name:'Project thumbnail'})).toHaveCount(0);
      await expect(visitor.getByRole('img',{name:replacementAlt})).toHaveCount(0);
    }finally{await isolated.close();}
    await page.getByRole('link',{name:'Back to project library'}).click();
    const cardImage=page.getByRole('img',{name:replacementAlt,exact:true});
    await expect(cardImage).toBeVisible();
    await page.getByRole('link',{name:title}).click();
    await expectImage(replacementAlt,replacementBytes);
    await cover.getByLabel('Confirm remove saved cover').check();
    await cover.getByRole('button',{name:'Remove thumbnail'}).click();
    await expect(cover.getByText('Private cover removed. Folder cover restored.',{exact:true})).toBeVisible();
    await page.reload();
    await expect(cover.getByText('Folder cover',{exact:true})).toBeVisible();
    await expect(cover.getByRole('img')).toHaveCount(0);
    await expect(revision).toHaveText('SAVED DRAFT · REVISION '+(base+4));
    expect(operations.length).toBe(5);
    expect(operations[4].p_asset_id===null).toBe(true);
    expect(uploads).toBe(2);expect(registrations).toBe(2);
  }finally{await other.close();}
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(page,foreign);
  await page.goto(projectPath);
  await expect(page.getByRole('alert')).toContainText('Project unavailable.');
  await expect(page.getByRole('region',{name:'Project thumbnail'})).toHaveCount(0);
  await expect(page.getByText(firstAlt,{exact:true})).toHaveCount(0);
  await expect(page.getByText(replacementAlt,{exact:true})).toHaveCount(0);
});

test('B16 C02 verified owner IndexedDB checkpoint, Keep Both, Restore and persisted save', async ({page}) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1','Disposable local Supabase only.');
  test.setTimeout(150_000);
  const owner=await localUser('C02 recovery owner');
  const foreign=await localUser('C02 foreign owner');
  const title='B16 C02 recovery fixture';
  const saved='C02 initial saved title',working='C02 unapplied recovery title',concurrent='C02 newer cloud title';
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill(title);
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  const portfolioId=editorPath.split('/').find(x=>/^[0-9a-f-]{36}$/.test(x));
  expect(!!portfolioId).toBe(true);
  const revision=page.locator('.ws-studio-editor .ws-heading').getByText(/Private draft · revision \d+/);
  const field=page.getByLabel('Text content');
  const save=page.getByRole('button',{name:'Save draft',exact:true});
  const details=page.locator('details.ws-editor-safety').filter({hasText:'Browser recovery & Keep Both'});
  const expand=async()=>{
    await expect(details).toBeVisible(); // Mandatory S14 verified owner context, no capability skip.
    if(await details.getAttribute('open')===null)await details.locator('summary').click();
    await expect(details.getByRole('button',{name:'Save browser recovery copy'})).toBeVisible();
  };
  await field.fill(saved);
  await page.getByRole('button',{name:'Apply text',exact:true}).click();
  await save.click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  const base=Number((await revision.innerText()).match(/revision (\d+)/)?.[1]);
  expect(Number.isSafeInteger(base)).toBe(true);
  await expand();
  await details.getByLabel('Automatically checkpoint unsaved edits on this browser during this editor session').check();
  await field.fill(working);
  await expect(details.getByText('Latest captured working edits acknowledged by browser storage only.',{exact:true})).toBeVisible();
  // Read only this disposable fixture's actual committed IndexedDB row, never dump raw records.
  const checkpointStored=await page.evaluate(({ownerId,portfolioId,working,base})=>new Promise<boolean>((resolve,reject)=>{
    const open=indexedDB.open('kadmeion-owner-drafts-recovery-v1',1);
    open.onerror=()=>reject(new Error('Recovery database read failed'));
    open.onsuccess=()=>{
      const db=open.result;
      try{
        const tx=db.transaction('recovery-copies','readonly');
        const query=tx.objectStore('recovery-copies').index('owner-portfolio').getAll([ownerId,portfolioId]);
        let verified=false;
        query.onsuccess=()=>{const rows=query.result;
          verified=rows.length===1&&rows[0].cloudBaseRevision===base&&
            Number.isSafeInteger(rows[0].checkpointSequence)&&rows[0].checkpointSequence>0&&
            Object.values(rows[0].payload.fieldDrafts).includes(working);
        };
        tx.oncomplete=()=>{db.close();resolve(verified);};
        tx.onabort=tx.onerror=()=>{db.close();reject(new Error('Recovery transaction failed'));};
      }catch{db.close();reject(new Error('Recovery store unavailable'));}
    };
  }),{ownerId:owner.id,portfolioId:portfolioId!,working,base});
  expect(checkpointStored).toBe(true);
  await expect(save).toBeDisabled();
  // Explicitly accept the product's dirty-navigation guard after the checkpoint.
  const acceptReload=async(dialog:import('@playwright/test').Dialog)=>{await dialog.accept();};
  page.on('dialog',acceptReload);
  try{await page.reload();}finally{page.off('dialog',acceptReload);}
  await expect(field).toHaveValue(saved);
  await expect(revision).toContainText('revision '+base+' · Saved privately');
  await expand();
  await expect(details.getByText(/Working checkpoint · .* · base revision/)).toHaveCount(1);
  await details.getByRole('button',{name:'Open recovery copy',exact:true}).click();
  await expect(details.getByText('Recovery copy opened as an unsaved working draft. Original copy and cloud revision unchanged.',{exact:true})).toBeVisible();
  await expect(field).toHaveValue(working);
  await expect(save).toBeDisabled();

  const other=await page.context().newPage();
  try{
    await other.goto(editorPath);
    await expect(other.getByLabel('Text content')).toHaveValue(saved);
    await other.getByLabel('Text content').fill(concurrent);
    await other.getByRole('button',{name:'Apply text',exact:true}).click();
    await other.getByRole('button',{name:'Save draft',exact:true}).click();
    await expect(other.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
    await details.getByRole('button',{name:'Keep Both and load latest cloud draft'}).click();
    await expect(details.getByText('Both versions preserved: browser recovery copy and latest saved cloud draft. No cloud revision was overwritten.',{exact:true})).toBeVisible();
    await expect(field).toHaveValue(concurrent);
    await expect(revision).toContainText('revision '+(base+1)+' · Saved privately');
    const copy=details.getByRole('listitem').filter({hasText:/^Recovery copy · /});
    await expect(copy).toHaveCount(1);
    await copy.getByRole('button',{name:'Compare copy',exact:true}).click();
    const restore=copy.getByRole('button',{name:'Restore older copy as unsaved draft'});
    await expect(restore).toBeEnabled();
    page.once('dialog',dialog=>dialog.dismiss());
    await restore.click();
    await expect(details.getByText('Recovery restore cancelled. Both versions remain unchanged.',{exact:true})).toBeVisible();
    await expect(field).toHaveValue(concurrent);
    await copy.getByRole('button',{name:'Compare copy',exact:true}).click();
    page.once('dialog',dialog=>dialog.accept());
    await restore.click();
    await expect(details.getByText(/Older recovery copy restored into an unsaved working draft/)).toBeVisible();
    await expect(field).toHaveValue(working);
    await expect(revision).toContainText('revision '+(base+1)+' · Uncommitted changes');
    await expect(save).toBeDisabled();
    await other.reload();
    await expect(other.getByLabel('Text content')).toHaveValue(concurrent);
    await page.getByRole('button',{name:'Apply text',exact:true}).click();
    await save.click();
    await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
    await page.reload();
    await expect(field).toHaveValue(working);
    await expect(revision).toContainText('revision '+(base+2)+' · Saved privately');
    await expand();
    await expect(copy).toHaveCount(1);
  }finally{await other.close();}
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(page,foreign);
  await page.goto(editorPath);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(details).toHaveCount(0);
  await expect(page.getByLabel('Text content')).toHaveCount(0);
  await expect(page.getByText(working,{exact:true})).toHaveCount(0);
});

test('B16 C09 actual private preflight link, bounded editor hints and unchanged saved revision',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(120_000);
  const owner=await localUser('C09 editor owner'),foreign=await localUser('C09 foreign owner');
  const title='B16 C09 private draft';
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill(title);
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  const revision=page.locator('.ws-studio-editor .ws-heading').getByText(/Private draft · revision \d+/);
  const field=page.getByLabel('Text content');
  const panels=page.getByRole('navigation',{name:'Editor panels'});
  const save=page.getByRole('button',{name:'Save draft',exact:true});
  const content='C09 assigned Arc introduction';
  // Exact slot key from createPortfolioPresetDraft: layout id + lower-case slot name.
  await page.goto(editorPath+'?panel=Content&slot=arc-hero-text');
  await expect(panels.getByRole('button',{name:'Content',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:/arc hero text/i})).toHaveAttribute('aria-pressed','true');
  await field.fill(content);
  await page.getByRole('button',{name:'Apply text',exact:true}).click();
  await save.click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  const base=Number((await revision.innerText()).match(/revision (\d+)/)?.[1]);
  expect(Number.isSafeInteger(base)).toBe(true);
  await page.goto(editorPath.replace(/\/edit$/,'/publish'));
  await page.getByRole('button',{name:'Run private preflight'}).click();
  await expect(page.getByRole('heading',{name:'Preflight results'})).toBeVisible();
  const link=page.getByRole('link',{name:'Edit SEO metadata in private editor'}).first();
  await expect(link).toHaveAttribute('href',editorPath+'?panel=Metadata');
  await link.click();
  await expect(panels.getByRole('button',{name:'Metadata',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('heading',{name:'Page metadata'})).toBeVisible();
  await expect(revision).toContainText('revision '+base+' · Saved privately');
  await expect(save).toBeDisabled();
  await page.goto(editorPath+'?panel=Content&slot=arc-hero-text');
  await expect(field).toHaveValue(content);
  await field.fill('C09 dirty local buffer');
  // A new same-document query string must not reapply hints over a dirty editor.
  await page.evaluate(()=>history.replaceState(history.state,'',location.pathname+'?panel=Metadata&slot=arc-hero-title'));
  await expect(field).toHaveValue('C09 dirty local buffer');
  await expect(panels.getByRole('button',{name:'Content',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Discard unapplied text'}).click();
  await expect(field).toHaveValue(content);
  await expect(revision).toContainText('revision '+base+' · Saved privately');
  await page.goto(editorPath+'?panel=Theme&panel=Source&slot=arc-hero-text&slot=arc-hero-title');
  await expect(page.getByRole('status').filter({hasText:'Requested editor panel and slot are unavailable.'})).toBeVisible();
  await expect(panels.getByRole('button',{name:'Content',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:/arc hero title/i})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Dismiss editor link notice'}).click();
  await expect(page.getByRole('button',{name:'Dismiss editor link notice'})).toHaveCount(0);
  await page.goto(editorPath+'?panel=Content&slot=missing-slot');
  await expect(page.getByRole('status').filter({hasText:'Requested slot is unavailable in this draft.'})).toBeVisible();
  await expect(page.getByRole('button',{name:/arc hero title/i})).toHaveAttribute('aria-pressed','true');
  await page.goto(editorPath+'?panel='+encodeURIComponent('https://example.invalid')+'&slot=__proto__');
  await expect(page.getByRole('status').filter({hasText:'Requested editor panel and slot are unavailable.'})).toBeVisible();
  await expect(revision).toContainText('revision '+base+' · Saved privately');
  await expect(save).toBeDisabled();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(page,foreign);
  await page.goto(editorPath+'?panel=Source&slot=arc-hero-text');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(panels).toHaveCount(0);
  await expect(page.getByLabel('Text content')).toHaveCount(0);
  await expect(page.getByText(content,{exact:true})).toHaveCount(0);
});

test('B16 WF-045 actual notification inbox retry, acknowledgement before navigation and dismissal',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(100_000);
  const owner=await localUser('WF-045 notice owner'),foreign=await localUser('WF-045 other owner');
  await signIn(page,owner);
  // This only records the disposable account-exit request, never executes erasure.
  await page.goto('/app/settings/account/delete');
  await page.getByRole('button',{name:'Review deletion prerequisites'}).click();
  await expect(page.getByRole('heading',{name:'Private inventory'})).toBeVisible();
  await page.getByRole('textbox',{name:'Type DELETE MY ACCOUNT to record the request'}).fill('DELETE MY ACCOUNT');
  await page.getByRole('button',{name:'Record deletion request'}).click();
  await expect(page.getByText('Deletion request recorded. No data has been erased.',{exact:true})).toBeVisible();
  // StrictMode can issue an abandoned first read and a second live read.
  // Fail every actual inbox GET until the explicit retry; never fail prefs.
  let inboxOutage=true,failedInboxReads=0;
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/private_notifications',async route=>{
    if(inboxOutage&&route.request().method()==='GET'){
      failedInboxReads++;await route.fulfill({status:503,json:{message:'Disposable inbox outage'}});
    }else await route.continue();
  });
  await page.goto('/app/notifications');
  const inbox=page.locator('section.ws-setting-card').filter({has:page.getByRole('heading',{name:'Inbox',exact:true})});
  await expect(inbox.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'Reviewer activity'})).toBeChecked();
  await expect(inbox.getByText('You’re caught up.')).toHaveCount(0);
  expect(failedInboxReads>0).toBe(true);
  inboxOutage=false;
  await inbox.getByRole('button',{name:'Retry notifications'}).click();
  const notice=inbox.getByRole('listitem').filter({hasText:'account exit requested'});
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText('Unread');
  await page.route('**/rest/v1/rpc/owner_acknowledge_notification',route=>route.fulfill({
    status:503,json:{message:'Disposable acknowledgement outage'}
  }),{times:1});
  await notice.getByRole('button',{name:'Review related area'}).click();
  await expect(inbox.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/notifications$/);
  await expect(notice).toContainText('Unread');
  await notice.getByRole('button',{name:'Review related area'}).click();
  await expect(page).toHaveURL(/\/app\/settings\/account\/delete$/);
  await page.goto('/app/notifications');
  await expect(notice.getByRole('button',{name:'Mark as read'})).toHaveCount(0);
  await expect(notice).toContainText(/· Read ·/);
  await inbox.getByRole('button',{name:'Unread',exact:true}).click();
  await expect(notice).toHaveCount(0);
  await inbox.getByRole('button',{name:'All loaded',exact:true}).click();
  await expect(notice).toBeVisible();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(page,foreign);
  await page.goto('/app/notifications');
  await expect(inbox.getByText('You’re caught up.')).toBeVisible();
  await expect(notice).toHaveCount(0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(page,owner);
  await page.goto('/app/notifications');
  await expect(notice).toBeVisible();
  await notice.getByRole('button',{name:'Dismiss',exact:true}).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(inbox.getByText('You’re caught up.')).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test('B16 C07 real goal concurrent CAS and precise 105-entry chronological history',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(125_000);
  const owner=await localUser('C07 goal owner'),foreign=await localUser('C07 other owner');
  const initial='C07 goal fixture',first='C07 retained stale edit',later='C07 concurrent saved edit';
  await signIn(page,owner);
  await page.goto('/app/growth/goals');
  await page.getByLabel('Goal title',{exact:true}).fill(initial);
  await page.getByRole('button',{name:'Create private goal'}).click();
  await page.getByRole('button',{name:initial,exact:true}).click();
  await page.getByRole('button',{name:'Edit selected goal'}).click();
  await page.getByLabel('Edit goal title').fill(first);
  const other=await page.context().newPage();
  try{
    await other.goto('/app/growth/goals');
    await other.getByRole('button',{name:initial,exact:true}).click();
    await other.getByRole('button',{name:'Edit selected goal'}).click();
    await other.getByLabel('Edit goal title').fill(later);
    await other.getByRole('button',{name:'Save goal details'}).click();
    await expect(other.getByText('Goal details updated privately.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Save goal details'}).click();
    const conflict=page.getByRole('region',{name:'Goal edit conflict'});
    await expect(conflict).toContainText(later);
    await expect(page.getByLabel('Edit goal title')).toHaveValue(first);
    await expect(page.getByRole('button',{name:'Save goal details'})).toBeDisabled();
    await other.reload();
    await expect(other.getByRole('button',{name:later,exact:true})).toBeVisible();
    await expect(other.getByRole('button',{name:first,exact:true})).toHaveCount(0);
    await conflict.getByRole('button',{name:'Use reviewed version as base and keep draft'}).click();
    await page.getByRole('button',{name:'Save goal details'}).click();
    await expect(page.getByText('Goal details updated privately.',{exact:true})).toBeVisible();
  }finally{await other.close();}
  await page.reload();
  await expect(page.getByRole('button',{name:first,exact:true})).toBeVisible();
  await page.goto('/app/growth/activity');
  const goalSelect=page.getByLabel('Activity goal');
  const id=await goalSelect.getByRole('option',{name:first,exact:true}).getAttribute('value');
  if(!id)throw new Error('Disposable goal fixture was not selectable.');
  // Local fixture only: two records share each exact microsecond, spanning both
  // 50-record cursor boundaries. Stable UUID suffix orders equal timestamp ties.
  runLocalFixtureSql("insert into public.private_goal_progress_events(id,goal_id,owner_user_id,operation_id,value,note,created_at) "+
    "select (left(:'actor_id',24)||lpad(g::text,12,'0'))::uuid,:'item_id'::uuid,:'actor_id'::uuid,gen_random_uuid(),g,"+
    "'C07 history '||lpad(g::text,3,'0'),'2026-01-01 00:00:00+00'::timestamptz+((g+1)/2)*interval '1 microsecond' "+
    "from generate_series(1,105) g;",owner.id,id);
  await goalSelect.selectOption(id);
  const history=page.getByRole('region',{name:'Private manual progress history'});
  await expect(history.getByRole('listitem')).toHaveCount(50);
  await history.getByRole('button',{name:'Load more history'}).click();
  await expect(history.getByRole('listitem')).toHaveCount(100);
  await history.getByRole('button',{name:'Load more history'}).click();
  await expect(history.getByRole('listitem')).toHaveCount(105);
  const notes=await history.locator('ol.ws-growth-events li p').allTextContents();
  const expected=Array.from({length:105},(_,i)=>'C07 history '+String(105-i).padStart(3,'0'));
  expect(notes).toEqual(expected);
  await expect(history.getByRole('button',{name:'Load more history'})).toHaveCount(0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(page,foreign);
  await page.goto('/app/growth/activity');
  await expect(goalSelect.getByRole('option',{name:first,exact:true})).toHaveCount(0);
  await expect(history.getByText('C07 history 105',{exact:true})).toHaveCount(0);
});

test('B16 My Components verified private versions, protected replacement and exact archived source',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(125_000);
  const owner=await localUser('S7 component owner'),foreign=await localUser('S7 other owner');
  const apiKey=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!apiKey||process.env.VITE_SUPABASE_URL!==origin)throw new Error('Disposable local owner API required.');
  // Seed actual private component versions through the owner-authorized RPC;
  // this proves discovery/reuse, not an unimplemented trusted customization flow.
  const login=await page.request.post(origin+'/auth/v1/token?grant_type=password',{
    headers:{apikey:apiKey},data:{email:owner.email,password:owner.password}
  });
  expect(login.ok()).toBe(true);
  const {access_token:token}=await login.json();
  await login.dispose();
  const original='export default function Original(){return null;}';
  const v1='export default function FixtureOne(){return null;}';
  const v2='export default function FixtureTwo(){return null;}';
  for(const fixture of [{key:'s6-title',name:'S6 Private Title',pin:'title-stacked@1',kind:'title',code:v1},
    {key:'s6-title',name:'S6 Private Title',pin:'title-stacked@1',kind:'title',code:v2},
    {key:'s6-paragraph',name:'S6 Private Paragraph',pin:'body-copy@1',kind:'text',code:'export default function Paragraph(){return null;}'}]){
    const result=await page.request.post(origin+'/rest/v1/rpc/owner_save_my_component',{
      headers:{apikey:apiKey,Authorization:'Bearer '+token},
      data:{p_operation_id:randomUUID(),p_component_key:fixture.key,p_display_name:fixture.name,
        p_base_component_pin:fixture.pin,p_pristine_source:original,p_source_code:fixture.code,p_slot_kinds:[fixture.kind]}
    });
    const ok=result.ok();await result.dispose();expect(ok).toBe(true);
  }
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('S6 component fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'S6 component fixture',level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  await page.getByRole('button',{name:/arc hero title/i}).click();
  await page.getByLabel('Text content').fill('S6 authored title preserved');
  await page.getByRole('button',{name:'Apply text',exact:true}).click();
  await page.getByRole('button',{name:'Save draft'}).click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'My Components',exact:true}).click();
  const library=page.locator('.ws-editor-tool').filter({has:page.getByRole('heading',{name:'My Components',exact:true})});
  const version1=library.getByRole('listitem').filter({hasText:'S6 Private Title · v1'});
  const version2=library.getByRole('listitem').filter({hasText:'S6 Private Title · v2'});
  const incompatible=library.getByRole('listitem').filter({hasText:'S6 Private Paragraph · v1'});
  await expect(version1).toBeVisible();await expect(version2).toBeVisible();
  await expect(incompatible.getByRole('button',{name:'Review replacement'})).toBeDisabled();
  await library.getByLabel('Search saved components').fill('no-such-private-component');
  await expect(library.getByText('No saved versions match these filters.')).toBeVisible();
  await library.getByRole('button',{name:'Clear filters'}).click();
  await library.getByLabel('Only versions compatible with the selected slot').check();
  await expect(incompatible).toHaveCount(0);
  const impact=page.getByRole('region',{name:'Replacement impact'});
  const revision=page.locator('.ws-studio-editor .ws-heading').getByText(/Private draft · revision \d+/);
  const before=await revision.innerText();
  await version1.getByRole('button',{name:'Review replacement'}).click();
  await expect(impact.getByRole('heading',{name:'Review replacement impact'})).toBeFocused();
  await impact.getByRole('button',{name:'Cancel replacement'}).click();
  await expect(impact).toHaveCount(0);
  await expect(revision).toHaveText(before);
  await expect(page.getByRole('button',{name:'Save draft'})).toBeDisabled();
  await version1.getByRole('button',{name:'Review replacement'}).click();
  await impact.getByRole('button',{name:'Replace and stash'}).click();
  await expect(library.getByText(/Replacement applied to the working draft/)).toBeVisible();
  await page.getByRole('button',{name:'Save draft'}).click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await version2.getByRole('button',{name:'Review replacement'}).click();
  await expect(impact.getByText(/Owned modified override \(S2\)/)).toBeVisible();
  await expect(impact.getByText(/Protected source:/)).toBeVisible();
  await impact.getByRole('button',{name:'Replace and stash'}).click();
  await page.getByRole('button',{name:'Save draft'}).click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:/arc hero title/i}).click();
  await expect(page.getByLabel('Text content')).toHaveValue('S6 authored title preserved');
  await page.goto('/app/export');
  await page.getByLabel('Portfolio to export').selectOption(editorPath.split('/')[3]!);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download portfolio source ZIP'}).click()]);
  const archivePath=await download.path();if(!archivePath)throw new Error('Disposable source archive unavailable.');
  const snapshot=importPortfolioSourceZip(new Uint8Array(await readFile(archivePath)));
  const active=snapshot.slots['arc-hero-title'],stash=snapshot.stashes['arc-hero-title']??[];
  expect(active?.state==='S2'&&!!active.sourcePath&&snapshot.files[active.sourcePath]===v2).toBe(true);
  expect(stash.some(slot=>!!slot.sourcePath&&slot.sourcePath!==active?.sourcePath&&snapshot.files[slot.sourcePath]===v1)).toBe(true);
  // No source evaluation and no public release are asserted from this private archive.
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await signIn(page,foreign);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('Foreign component fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await page.getByRole('button',{name:'My Components',exact:true}).click();
  await expect(page.getByText('You haven’t saved any component versions.')).toBeVisible();
  await expect(page.getByText('S6 Private Title',{exact:false})).toHaveCount(0);
});

test('B16 WF-049/052 real moderation case and appeal lost acknowledgement replay',async({page,browser},testInfo)=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(120_000);
  const operator=await localUser('S11 replay operator'),subject=await localUser('S11 replay subject');
  grantLocalOperatorRole(operator.id);
  const captureOps=async(p:Page,rpc:string)=>{
    const operations:string[]=[];let committed=false;
    await p.route('**/rest/v1/rpc/'+rpc,async route=>{
      const input=route.request().postDataJSON() as {p_operation_id:string};
      operations.push(input.p_operation_id);
      const result=await route.fetch();
      try{
        if(!committed&&result.ok()){committed=true;await route.abort('failed');}
        else await route.fulfill({response:result});
      }finally{await result.dispose();}
    });
    return {operations,committed:()=>committed};
  };
  await signIn(page,operator);
  await page.goto('/app/operations/users');
  const rationale='Disposable documented test case for lost acknowledgement replay.';
  await page.getByLabel('Exact target user ID').fill(subject.id);
  await page.getByLabel('Case summary').fill(rationale);
  await page.getByLabel('I confirm the serious-abuse scope and understand this is audit-only.').check();
  const open=await captureOps(page,'operator_open_moderation_case');
  await page.getByRole('button',{name:'Record private case'}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(open.committed()).toBe(true);
  await expect(page.getByLabel('Case summary')).toHaveValue(rationale);
  await expect(page.getByLabel('I confirm the serious-abuse scope and understand this is audit-only.')).toBeChecked();
  await page.getByRole('button',{name:'Record private case'}).click();
  await expect(page.getByRole('status')).toContainText('Private audit case recorded.');
  expect(open.operations.length===2&&open.operations[0]===open.operations[1]).toBe(true);
  await expect(page.getByText('Owner ID '+subject.id,{exact:true})).toHaveCount(1);
  const context=await browser.newContext({baseURL:testInfo.project.use.baseURL});
  try{
    const subjectPage=await context.newPage();await signIn(subjectPage,subject);
    await subjectPage.goto('/app/settings/cases');
    await subjectPage.getByLabel('Case to review').selectOption({index:1});
    const statement='Disposable private appeal statement with lost acknowledgement.';
    await subjectPage.getByLabel('Appeal statement').fill(statement);
    const appeal=await captureOps(subjectPage,'owner_appeal_moderation_case');
    await subjectPage.getByRole('button',{name:'Submit private appeal'}).click();
    await expect(subjectPage.getByRole('alert')).toContainText('The appeal could not be confirmed.');
    expect(appeal.committed()).toBe(true);
    await expect(subjectPage.getByLabel('Appeal statement')).toHaveValue(statement);
    await subjectPage.getByRole('button',{name:'Submit private appeal'}).click();
    await expect(subjectPage.getByRole('heading',{name:'Appeal pending'})).toBeVisible();
    expect(appeal.operations.length===2&&appeal.operations[0]===appeal.operations[1]).toBe(true);
    await subjectPage.reload();
    await subjectPage.getByLabel('Case to review').selectOption({index:1});
    await expect(subjectPage.getByRole('heading',{name:'Appeal pending'})).toBeVisible();
    await expect(subjectPage.getByRole('list',{name:'Case events'}).getByText(statement,{exact:true})).toHaveCount(1);
    await subjectPage.goto('/app/operations/appeals');
    await expect(subjectPage.getByRole('heading',{name:'Restricted operations.'})).toBeVisible();
  }finally{await context.close();}
});


test('B16 private folder journal and portable JSON compare restore, undo and saved readback',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(140_000);
  const owner=await localUser('S3 folder and JSON owner');
  // Real Chromium OPFS handles, real journal/Web Locks, with only the OS
  // directory picker replaced by a deterministic disposable test directory.
  // This cannot certify a native desktop permission/picker interaction.
  const folderName='s6-'+randomUUID();
  await page.addInitScript(name=>{
    Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>{
      const root=await navigator.storage.getDirectory();
      return root.getDirectoryHandle(name,{create:true});
    }});
  },folderName);
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('S6 folder JSON fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'S6 folder JSON fixture',level:1})).toBeVisible();
  const field=page.getByLabel('Text content');
  const save=page.getByRole('button',{name:'Save draft',exact:true});
  const revision=page.locator('.ws-studio-editor .ws-heading').getByText(/Private draft · revision \d+/);
  const setTitle=async(value:string)=>{
    await field.fill(value);await page.getByRole('button',{name:'Apply text',exact:true}).click();
    await save.click();await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  };
  const original='S6 original saved Unicode \u2603';
  const changed='S6 newer cloud title';
  await setTitle(original);
  const base=Number((await revision.innerText()).match(/revision (\d+)/)?.[1]);
  expect(Number.isSafeInteger(base)).toBe(true);
  const folder=page.locator('details.ws-editor-safety').filter({has:page.getByText('Private folder backup & recovery',{exact:true})});
  const portable=page.locator('details.ws-editor-safety').filter({has:page.getByText('Private project JSON import & export',{exact:true})});
  const expand=async(panel:typeof folder)=>{await expect(panel).toBeVisible();if(await panel.getAttribute('open')===null)await panel.locator('summary').click();};
  const confirm=async(button:ReturnType<typeof folder.getByRole>,accept=true)=>{
    // Observe and finish this specific dialog before another action can
    // install a handler. A missing confirmation must fail this action.
    await Promise.all([
      page.waitForEvent('dialog',{timeout:10_000}).then(dialog=>accept?dialog.accept():dialog.dismiss()),
      button.click()
    ]);
  };
  await expand(folder);await expand(portable);
  await field.fill('Unapplied test buffer');
  await expect(folder.getByRole('button',{name:'Create private folder backup'})).toBeDisabled();
  await expect(portable.getByRole('button',{name:'Export private project JSON'})).toBeDisabled();
  await page.getByRole('button',{name:'Discard unapplied text'}).click();
  await expect(field).toHaveValue(original);
  const backup=folder.getByRole('button',{name:'Create private folder backup'});
  await confirm(backup,false);
  await expect(folder.getByText('Folder backup cancelled. Draft unchanged.',{exact:true})).toBeVisible();
  await confirm(backup);
  await expect(folder.getByText('New folder backup saved. Cloud draft unchanged; image files are not included.',{exact:true})).toBeVisible();
  const verified=await page.evaluate(async({name,text})=>{
    const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle(name);
    const meta=await dir.getDirectoryHandle('.kadmeion');
    const head=JSON.parse(await (await (await meta.getFileHandle('editor-head.json')).getFile()).text());
    let journalGone=false;
    try{await meta.getFileHandle('transaction-journal.json');}catch(e){journalGone=e instanceof DOMException&&e.name==='NotFoundError';}
    const pages=await dir.getDirectoryHandle('pages');
    const pageBytes=await (await (await pages.getFileHandle('home.page.json')).getFile()).text();
    const {sha256,...body}=head;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)))),v=>v.toString(16).padStart(2,'0')).join('');
    return journalGone&&sha256===digest&&pageBytes===head.head.snapshot.files['pages/home.page.json']&&head.head.snapshot.slots['arc-hero-title'].content.title===text;
  },{name:folderName,text:original});
  expect(verified).toBe(true);
  await confirm(backup);
  await expect(folder.getByText(/Folder conflict or existing backup detected/)).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),portable.getByRole('button',{name:'Export private project JSON'}).click()]);
  const localPath=await download.path();if(!localPath)throw Error('Disposable JSON download absent.');
  const bytes=await readFile(localPath);
  const payload=JSON.parse(bytes.toString('utf8'));
  expect(payload.kind==='kadmeion-private-project'&&payload.formatVersion===1&&payload.snapshot.slots['arc-hero-title'].content.title===original).toBe(true);
  await expect(revision).toContainText('revision '+base+' · Saved privately');
  await setTitle(changed);
  await confirm(folder.getByRole('button',{name:'Compare private folder backup'}));
  await expect(folder.getByText('Compared the verified folder snapshot with the current cloud draft. Both remain separate.',{exact:true})).toBeVisible();
  const comparison=folder.locator('[aria-label="Folder backup comparison"]');
  await expect(comparison).toBeVisible();
  await expect(field).toHaveValue(changed);
  await confirm(comparison.getByRole('button',{name:'Restore compared folder as unsaved draft'}));
  await expect(folder.getByText(/Folder snapshot opened as an unsaved working draft/)).toBeVisible();
  await expect(field).toHaveValue(original);
  await expect(revision).toContainText('revision '+(base+1)+' · Uncommitted changes');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(field).toHaveValue(changed);
  // Undo is local; reload the confirmed cloud draft before importing.
  const acceptReload=async(dialog:import('@playwright/test').Dialog)=>{await dialog.accept();};
  page.on('dialog',acceptReload);try{await page.reload();}finally{page.off('dialog',acceptReload);}
  await expect(field).toHaveValue(changed);
  await expand(portable);const input=portable.getByLabel('Compare private project JSON');
  await expect(input).toBeEnabled();
  await input.setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...payload,extra:true}))});
  await expect(portable.getByText(/Snapshot operation rejected or not confirmed/)).toBeVisible();
  await expect(field).toHaveValue(changed);
  await input.setInputFiles({name:'snapshot.json',mimeType:'application/json',buffer:bytes});
  const jsonComparison=portable.locator('[aria-label="Portable snapshot comparison"]');
  await expect(jsonComparison).toBeVisible();
  await expect(field).toHaveValue(changed);
  await confirm(jsonComparison.getByRole('button',{name:'Restore compared JSON as unsaved draft'}),false);
  await expect(field).toHaveValue(changed);
  await confirm(jsonComparison.getByRole('button',{name:'Restore compared JSON as unsaved draft'}));
  await expect(portable.getByText(/Imported as an unsaved draft/)).toBeVisible();
  await expect(field).toHaveValue(original);
  await expect(revision).toContainText('revision '+(base+1)+' · Uncommitted changes');
  await save.click();await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await page.reload();await expect(field).toHaveValue(original);
  await expect(revision).toContainText('revision '+(base+2)+' · Saved privately');
});

test('B16 C10 mounted layout mapping preserves assignments through one Undo, save and source export',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(120_000);
  const owner=await localUser('C10 mounted layout owner');
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('C10 layout preservation fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'C10 layout preservation fixture',level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  await page.getByRole('button',{name:/arc hero title/i}).click();
  await page.getByLabel('Text content').fill('C10 preserved title');
  await page.getByRole('button',{name:'Apply text',exact:true}).click();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Components',exact:true}).click();
  const layout=page.getByRole('region',{name:'Change section layout',exact:true});
  await layout.getByLabel('Target layout').selectOption('stepped-hero@1');
  // Every filled source receives an explicit decision, including full stashes.
  const fields=layout.locator('label').filter({hasText:'Destination for '});
  const count=await fields.count();expect(count).toBe(5);
  for(let index=0;index<count;index++){
    const field=fields.nth(index),label=await field.innerText();
    const select=field.locator('select');
    if(label.startsWith('Destination for arc-hero-title'))await select.selectOption('arc-hero-title');
    else if(label.startsWith('Destination for arc-hero-cta1'))await select.selectOption('arc-hero-cta');
    else await select.selectOption({label:'Unplaced — stash complete assignment'});
  }
  await layout.getByRole('button',{name:'Review layout impact',exact:true}).click();
  const confirmation=layout.getByRole('region',{name:'Layout change confirmation'});
  await expect(confirmation.getByRole('heading',{name:'Confirm layout transformation'})).toBeFocused();
  await expect(confirmation.getByRole('button',{name:'Confirm layout change'})).toBeDisabled();
  await confirmation.getByRole('checkbox',{name:'Confirm preservation of outgoing assignments in Unplaced'}).check();
  await confirmation.getByRole('button',{name:'Confirm layout change'}).click();
  await expect(layout.getByText(/Current: L5 · stepped hero\./)).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(layout.getByLabel('Target layout').getByRole('option',{name:/stepped hero/})).toHaveCount(1);
  await expect(layout.getByText(/Current: L1 · arc hero\./)).toBeVisible();
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect(layout.getByText(/Current: L5 · stepped hero\./)).toBeVisible();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await page.goto('/app/export');
  await page.getByLabel('Portfolio to export').selectOption(editorPath.split('/')[3]!);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download portfolio source ZIP'}).click()]);
  const path=await download.path();if(!path)throw new Error('Private source export absent.');
  const snapshot=importPortfolioSourceZip(new Uint8Array(await readFile(path)));
  expect(JSON.parse(snapshot.files['pages/home.page.json']).sections[0].layout).toBe('stepped-hero@1');
  expect(snapshot.slots['arc-hero-title'].content.title).toBe('C10 preserved title');
  expect(snapshot.stashes['arc-hero-text']?.length).toBeGreaterThan(0);
  expect(snapshot.slots['arc-hero-cta']?.componentId).toBe('external-link@1');
});

test('B16 verified owner and workspace glyph pending states are real, decorative and reduced-motion safe',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(100_000);
  const owner=await localUser('S14 glyph fixture');
  await signIn(page,owner);
  await page.emulateMedia({reducedMotion:'reduce'});
  let releaseAuth!:()=>void,releaseRecords!:()=>void;
  const authHold=new Promise<void>(resolve=>{releaseAuth=resolve;});
  const recordsHold=new Promise<void>(resolve=>{releaseRecords=resolve;});
  // Real provider response held by test only, never a fabricated success
  // nor an artificial delay added to the production source.
  await page.route('**/auth/v1/user',async route=>{
    const response=await route.fetch();try{await authHold;await route.fulfill({response});}finally{await response.dispose();}
  }); // Hold every StrictMode verification read until explicitly released.
  await page.route('**/rest/v1/projects?*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin&&url.searchParams.get('limit')==='5'){
      const response=await route.fetch();try{await recordsHold;await route.fulfill({response});}finally{await response.dispose();}
    }else await route.continue();
  });
  const glyphCheck=async(container:ReturnType<Page['locator']>)=>{
    const glyph=container.locator('.glyph-skeleton').first();
    await expect(glyph).toBeVisible();
    const hidden=await glyph.evaluate(node=>!!node.closest('[aria-hidden="true"]'));
    expect(hidden).toBe(true);
    const line=glyph.locator('.glyph-skeleton-line').first();
    await expect(line).toBeVisible();
    expect(await line.evaluate(node=>{const style=getComputedStyle(node);return style.animationName==='none'&&style.maskImage!=='none'&&node.getBoundingClientRect().width>0;})).toBe(true);
    await expect(glyph.locator('button,a,input,[tabindex="0"]')).toHaveCount(0);
  };
  try{
    await page.goto('/app',{waitUntil:'domcontentloaded'});
    const gate=page.locator('main.ws-gate[aria-busy="true"]');
    await expect(gate.getByRole('heading',{name:'Verifying owner session…'})).toBeVisible();
    await glyphCheck(gate);
    await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);
    releaseAuth();
    const records=page.locator('section.ws-loading[aria-busy="true"]');
    await expect(records.getByRole('status')).toHaveText('Loading your private workspace records…');
    await glyphCheck(records);
    releaseRecords();
    await expect(records).toHaveCount(0);
    await expect(page.locator('.glyph-skeleton')).toHaveCount(0);
    await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toBeVisible();
    await auditAccessibility(page,'B16_S14_GLYPH_RESOLVED_REDUCED',process.env.KADMEION_BROWSER_CAPTURE_DIR);
  }finally{releaseAuth();releaseRecords();}
});

test('B16 WF-012 real uncertain quick-add checks durable insert and acknowledged readback without duplicate writes',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase and S2 uncertainty fence required.');
  test.setTimeout(115_000);
  const owner=await localUser('S6 quick-add uncertain owner');
  await page.setViewportSize({width:1600,height:1000});
  await signIn(page,owner);
  await page.goto('/app/projects');
  await expect(page.getByRole('heading',{name:'Your first project belongs here.'})).toBeVisible();
  let mode:'before503'|'lostAck'|'read503'|'real'='before503';
  let postCount=0,committed=0,readFailures=0;
  let acknowledgedId:string|null=null;
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/projects',async route=>{
    const method=route.request().method();
    if(method==='POST'){
      postCount++;
      if(mode==='before503'){
        mode='real';
        return route.fulfill({status:503,json:{message:'Disposable pre-insert outage'}});
      }
      const response=await route.fetch();
      try{
        if(response.ok()){
          const rows=await response.json();
          if(!Array.isArray(rows)||rows.length!==1||typeof rows[0]?.id!=='string')throw new Error('Real insert receipt missing.');
          committed++;acknowledgedId=rows[0].id;
          if(mode==='lostAck'){mode='real';return await route.abort('failed');}
        }
        await route.fulfill({response});
      }finally{await response.dispose();}
      return;
    }
    if(method==='GET'&&mode==='read503'&&acknowledgedId&&new URL(route.request().url()).searchParams.get('id')==='eq.'+acknowledgedId){
      readFailures++;mode='real';return route.fulfill({status:503,json:{message:'Disposable post-insert read outage'}});
    }
    await route.continue();
  });
  const drawer=page.getByRole('dialog',{name:'Add a project'});
  const title=drawer.getByLabel('Project title');
  const summary=drawer.getByLabel('Summary (optional)');
  const slug=drawer.getByLabel('Private URL slug');
  const repository=drawer.getByLabel('Repository URL (optional)');
  const live=drawer.getByLabel('Live website URL (optional)');
  const save=drawer.getByRole('button',{name:'Save project'});
  const check=drawer.getByRole('button',{name:'Check saved project before retry'});
  async function open(label:string,privateSlug:string,first=false){
    await page.getByRole('button',{name:first?'Add first project':'Add project',exact:true}).click();
    await title.fill(label);
    // The native details disclosure survives closing and reopening the drawer.
    if(!await slug.isVisible())await drawer.getByText('Edit private URL slug',{exact:true}).click();
    await expect(slug).toBeVisible();
    await slug.fill(privateSlug);await summary.fill('Durable recovery fixture');
    await repository.fill('https://example.com/repo');await live.fill('https://example.com/live');
  }
  async function retain(label:string,privateSlug:string){
    await expect(drawer).toBeVisible();await expect(check).toBeEnabled();await expect(save).toBeDisabled();
    await expect(title).toHaveValue(label);await expect(slug).toHaveValue(privateSlug);
    await expect(summary).toHaveValue('Durable recovery fixture');
    await expect(repository).toHaveValue('https://example.com/repo');
    await expect(live).toHaveValue('https://example.com/live');
  }
  await open('S6 before insert','s6-before-insert',true);await save.click();
  await retain('S6 before insert','s6-before-insert');
  expect(postCount).toBe(1);expect(committed).toBe(0);
  await check.click();await expect(drawer.getByRole('alert')).toContainText('No matching saved project was found');
  await expect(save).toBeEnabled();expect(postCount).toBe(1);
  await save.click();await expect(drawer).toBeHidden();expect(postCount).toBe(2);expect(committed).toBe(1);
  await expect(page.getByRole('link',{name:'S6 before insert'})).toBeVisible();
  mode='lostAck';acknowledgedId=null;
  await open('S6 lost acknowledgement','s6-lost-ack');await save.click();
  await retain('S6 lost acknowledgement','s6-lost-ack');expect(postCount).toBe(3);expect(committed).toBe(2);
  await check.click();await expect(drawer).toBeHidden();expect(postCount).toBe(3);
  await expect(page.getByRole('link',{name:'S6 lost acknowledgement'})).toBeVisible();
  mode='read503';acknowledgedId=null;
  await open('S6 acknowledged readback','s6-readback');await save.click();
  await retain('S6 acknowledged readback','s6-readback');expect(readFailures).toBe(1);
  expect(postCount).toBe(4);expect(committed).toBe(3);
  await check.click();await expect(drawer).toBeHidden();expect(postCount).toBe(4);
  await expect(page.getByText('The acknowledged private project was verified. No additional write was made.',{exact:true})).toBeVisible();
  await page.reload();
  for(const label of ['S6 before insert','S6 lost acknowledgement','S6 acknowledged readback']){
    await expect(page.getByRole('link',{name:label,exact:true})).toHaveCount(1);
  }
  const rows=runLocalFixtureSql("select count(*) from public.projects where owner_user_id=:'actor_id'::uuid and slug in ('s6-before-insert','s6-lost-ack','s6-readback');",owner.id);
  expect(rows).toBe('3');expect(postCount).toBe(4);
});

test('B16 auth confirmation denial, neutral resend failures and explicit retry (injected provider boundary)', async ({page}) => {
  test.skip(process.env.KADMEION_LOCAL_BROWSER !== '1','Requires disposable local Supabase.');
  test.setTimeout(60_000);
  const owner=await localUser('S6 confirmation boundary');
  let tokenCalls=0, resendCalls=0;
  let mode:'deny'|'rate'|'outage'|'transport'|'nonjson'|'null'|'unexpected'|'empty204'|'accepted'='deny';
  await page.route(url=>url.origin===origin&&url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    tokenCalls++;
    await route.fulfill({status:400,json:{error_code:'email_not_confirmed',msg:'S6_RAW_PROVIDER_MARKER'}});
  });
  await page.route(url=>url.origin===origin&&url.pathname==='/auth/v1/resend',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    resendCalls++;
    const body=route.request().postDataJSON();
    expect(body.type==='signup'&&body.email===owner.email).toBe(true);
    expect(new URL(route.request().url()).searchParams.get('redirect_to')).toBe(new URL('/auth/callback',page.url()).href);
    if(mode==='transport')return route.abort('failed');
    if(mode==='nonjson')return route.fulfill({status:200,contentType:'text/html',body:'S6_RAW_PROVIDER_MARKER'});
    if(mode==='null')return route.fulfill({status:200,contentType:'application/json',body:'null'});
    if(mode==='unexpected')return route.fulfill({status:200,json:{access_token:'S6_RAW_PROVIDER_MARKER'}});
    if(mode==='empty204')return route.fulfill({status:204});
    if(mode==='accepted')return route.fulfill({status:200,json:{}});
    await route.fulfill({status:mode==='deny'?403:mode==='rate'?429:503,json:{message:'S6_RAW_PROVIDER_MARKER'}});
  });
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(owner.email);
  await page.locator('#signin-password').fill(owner.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Registration submitted'})).toBeVisible();
  expect(tokenCalls).toBe(1);
  const resend=page.getByRole('button',{name:'Request another confirmation link'});
  const noWorkspace=async()=>{
    await expect(page.getByRole('link',{name:'Open private workspace'})).toHaveCount(0);
    await expect(page.getByText('S6_RAW_PROVIDER_MARKER',{exact:false})).toHaveCount(0);
  };
  for(const failure of ['deny','rate','outage','transport','nonjson','null','unexpected','empty204'] as const){
    mode=failure;
    await resend.click();
    await expect(page.getByRole('heading',{name:'Action not completed'})).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Unable to submit the confirmation request.');
    await expect(page.getByText('provider accepted another request',{exact:false})).toHaveCount(0);
    await expect(resend).toBeEnabled();
    await noWorkspace();
  }
  expect(resendCalls).toBe(8);
  mode='accepted';
  await resend.click();
  await expect(page.getByRole('status')).toContainText('Email delivery is not confirmed.');
  expect(resendCalls).toBe(9);
  await noWorkspace();
  await page.goto('/app');
  await expect(page.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Go to sign in'})).toBeVisible();
  await expect(page.locator('.ws-shell')).toHaveCount(0);
});

test('B16 real invalid and absent recovery grants cannot open reset form or mutate password',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires disposable local Supabase.');
  test.setTimeout(45_000);
  let writes=0;
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.origin===origin&&url.pathname==='/auth/v1/user'&&request.method()==='PUT')writes++;
  });
  await page.goto('/reset-password');
  await expect(page.getByRole('alert')).toContainText('does not contain an active recovery grant');
  await expect(page.getByRole('button',{name:'Save new password'})).toHaveCount(0);
  const invalid=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');
  const provider=page.waitForResponse(response=>{
    const url=new URL(response.url());
    return url.origin===origin&&url.pathname==='/auth/v1/verify'&&response.request().method()==='POST';
  });
  await page.goto('/reset-password?type=recovery&token_hash='+invalid);
  const receipt=await provider;
  expect(receipt.ok()).toBe(false);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button',{name:'Save new password'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Open private workspace'})).toHaveCount(0);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('');
  await page.goto('/app');
  await expect(page.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
  await expect(page.locator('.ws-shell')).toHaveCount(0);
  expect(writes).toBe(0);
});

test('B16 C10 real trusted static scoped-theme CSS uses measured 600/950 boundaries',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires S3 R4 shared engine and trusted static renderer.');
  const {createPortfolioPresetDraft,createEditorHead,applyEditorTransaction,prepareSafeStaticPreview}=await import('../../../packages/editor-core/src/index.ts');
  const snapshot=createPortfolioPresetDraft('stairs');
  const manifest=JSON.parse(snapshot.files['kadmeion.json']);
  snapshot.files['kadmeion.json']=JSON.stringify({...manifest,seo:{title:'Scoped fixture',description:'Private static scoped fixture'}});
  const document=JSON.parse(snapshot.files['pages/home.page.json']);
  const section=document.sections[0];
  snapshot.files['pages/home.page.json']=JSON.stringify({...document,sections:[section]});
  for(const [key,slot] of Object.entries(snapshot.slots)){
    if(!key.startsWith('stepped-hero-')&&slot.state==='S0')snapshot.slots[key]={state:'EMPTY',content:{}};
  }
  snapshot.slots['stepped-hero-title']={state:'S0',componentId:'title-stacked@1',content:{title:'Real scoped heading',subtitle:'Private preview'}};
  snapshot.slots['stepped-hero-cta']={state:'S0',componentId:'external-link@1',content:{label:'Example',url:'https://example.com/work'}};
  snapshot.files['theme/tokens.json']=JSON.stringify({mode:'light',surface:'#ffffff',text:'#222222',accent:'#444444'});
  let head=createEditorHead(snapshot);
  const change=(scope:{kind:'global'}|{kind:'template'|'section'|'component';id:string},
    layer:'base'|'phone'|'tablet'|'desktop',value:string)=>{
    head=applyEditorTransaction(head,{operationId:randomUUID(),baseRevision:head.revision,
      intent:{kind:'EDIT_SCOPED_THEME',expectedRevision:head.revision,mode:'light',scope,layer,
        edit:{kind:'set',key:'text',value}}});
  };
  change({kind:'global'},'base','#111111');
  change({kind:'template',id:'stairs'},'base','#333333');
  change({kind:'section',id:section.id},'base','#555555');
  change({kind:'component',id:'stepped-hero-title'},'phone','#224466');
  change({kind:'component',id:'stepped-hero-title'},'tablet','#336633');
  change({kind:'component',id:'stepped-hero-title'},'desktop','#663344');
  const id='10000000-0000-4000-8000-000000000001',sha='a'.repeat(64);
  // Synthetic frozen envelope for isolated compiler/browser geometry proof;
  // this is not a database frozen receipt or hosted publication claim.
  const render=()=>prepareSafeStaticPreview({
    snapshot:head.snapshot,frozen:{portfolioId:id,revision:1,snapshotSha256:sha,status:'FROZEN',publicUrl:null,visibilityIntent:'PUBLIC'},
    loadedPortfolioId:id,loadedRevision:1,loadedSnapshotSha256:sha,
    plan:[
      {slotKey:'stepped-hero-title',componentId:'title-stacked@1',kind:'heading',required:true},
      {slotKey:'stepped-hero-cta',componentId:'external-link@1',kind:'external-link',required:false}
    ]
  });
  const result=render();
  expect(result.status).toBe('PREVIEW_ONLY');
  expect(result.publicationReady).toBe(false);
  if(!result.previewHtml)throw new Error('Scoped trusted static preview missing.');
  await page.setViewportSize({width:1600,height:900});
  await page.setContent(result.previewHtml);
  const container=page.locator('.k-theme-container'),slot=page.locator('.k-theme-slot-0');
  for(const [width,color] of [[600,'rgb(34, 68, 102)'],[601,'rgb(51, 102, 51)'],
    [950,'rgb(51, 102, 51)'],[951,'rgb(102, 51, 68)']] as const){
    await container.evaluate((node,w)=>{(node as HTMLElement).style.width=w+'px';},width);
    await expect.poll(()=>container.evaluate(node=>node.getBoundingClientRect().width)).toBeCloseTo(width,0);
    await expect(slot).toHaveCSS('color',color);
    await expect(page.locator('.k-theme-section-0')).toHaveCSS('color','rgb(85, 85, 85)');
    await expect(page.locator('.k-theme-root')).toHaveCSS('color','rgb(51, 51, 51)');
  }
  const before=structuredClone(head.snapshot);
  head=applyEditorTransaction(head,{operationId:randomUUID(),baseRevision:head.revision,
    intent:{kind:'EDIT_SCOPED_THEME',expectedRevision:head.revision,mode:'light',
      scope:{kind:'component',id:'stepped-hero-title'},layer:'desktop',edit:{kind:'reset',key:'text'}}});
  const reset=render();
  expect(reset.status).toBe('PREVIEW_ONLY');
  if(!reset.previewHtml)throw new Error('Static reset preview missing.');
  await page.setContent(reset.previewHtml);
  await page.locator('.k-theme-container').evaluate(node=>{(node as HTMLElement).style.width='951px';});
  await expect(page.locator('.k-theme-slot-0')).toHaveCSS('color','rgb(85, 85, 85)');
  head=applyEditorTransaction(head,{operationId:randomUUID(),baseRevision:head.revision,intent:{kind:'UNDO'}});
  expect(head.snapshot).toEqual(before);
});

test('B16 C06 opt-in autosave coalesces private edits, stops on failure and never confirms withdrawal',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires disposable local Supabase.');
  test.setTimeout(65_000);
  const owner=await localUser('S6 profile autosave');
  await signIn(page,owner);
  await page.goto('/app/profile');
  const headline=page.getByLabel('Headline',{exact:true});
  const auto=page.getByRole('checkbox',{name:'Autosave private profile fields'});
  await expect(headline).toBeVisible();
  await expect(auto).not.toBeChecked();
  const writes:Array<{headline:string;withdrawal:boolean}>=[];
  let deny=false;
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/owner_save_profile_draft',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const data=route.request().postDataJSON();
    writes.push({headline:data.p_draft.headline,withdrawal:data.p_confirm_projection_withdrawal});
    if(deny)return route.fulfill({status:503,json:{message:'S6 synthetic outage'}});
    await route.continue();
  });
  await headline.fill('Off by default');
  // Negative observation exceeds the 1200ms documented debounce.
  await page.waitForTimeout(1500);
  expect(writes).toHaveLength(0);
  await auto.check();
  await headline.fill('Intermediate');
  await headline.fill('Final private draft');
  await expect(page.getByText('Private profile draft autosaved.',{exact:true})).toBeVisible();
  expect(writes).toEqual([{headline:'Final private draft',withdrawal:false}]);
  await page.reload();
  await expect(headline).toHaveValue('Final private draft');
  await expect(auto).not.toBeChecked();
  deny=true;
  await auto.check();
  await headline.fill('Retained after outage');
  await expect(auto).not.toBeChecked();
  await expect(headline).toHaveValue('Retained after outage');
  await expect(page.getByRole('button',{name:'Save profile draft'})).toBeDisabled();
  await page.waitForTimeout(1500);
  expect(writes).toEqual([{headline:'Final private draft',withdrawal:false},{headline:'Retained after outage',withdrawal:false}]);
});

test('B16 C06 pending skill pauses scheduled autosave until add or clear',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires disposable local Supabase and S2 pending-skill successor.');
  test.setTimeout(60_000);
  const owner=await localUser('S6 pending skill');
  await signIn(page,owner);
  await page.goto('/app/profile');
  const headline=page.getByLabel('Headline',{exact:true});
  const auto=page.getByRole('checkbox',{name:'Autosave private profile fields'});
  await expect(headline).toBeVisible();
  await page.getByRole('button',{name:'Skills & links',exact:true}).click();
  const skill=page.getByLabel('Add skill',{exact:true});
  await skill.fill('TypeScript');
  await page.getByRole('button',{name:'Add skill',exact:true}).click();
  await page.getByRole('button',{name:'Save profile draft'}).click();
  await expect(page.getByText('Private profile draft saved.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Profile',exact:true}).click();
  const writes:Array<{headline:string;skills:string[];withdrawal:boolean}>=[];
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/owner_save_profile_draft',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const body=route.request().postDataJSON();
    writes.push({headline:body.p_draft.headline,skills:body.p_draft.skills,withdrawal:body.p_confirm_projection_withdrawal});
    await route.continue();
  });
  await auto.check();
  await headline.fill('Pending skill must pause this save');
  await page.getByRole('button',{name:'Skills & links',exact:true}).click();
  await skill.fill('typescript');
  await page.getByRole('button',{name:'Add skill',exact:true}).click();
  await expect(page.getByText('This skill is already in your profile.',{exact:true})).toBeVisible();
  await page.waitForTimeout(1500);
  expect(writes).toHaveLength(0);
  await skill.fill('Rust');
  await page.waitForTimeout(1500);
  expect(writes).toHaveLength(0);
  await page.getByRole('button',{name:'Add skill',exact:true}).click();
  await expect(page.getByText('Private profile draft autosaved.',{exact:true})).toBeVisible();
  expect(writes).toEqual([{headline:'Pending skill must pause this save',skills:['TypeScript','Rust'],withdrawal:false}]);
  await page.getByRole('button',{name:'Profile',exact:true}).click();
  await headline.fill('Clear pending skill resumes save');
  await page.getByRole('button',{name:'Skills & links',exact:true}).click();
  await skill.fill('Unadded skill');
  await page.waitForTimeout(1500);
  expect(writes).toHaveLength(1);
  await skill.fill('');
  await expect(page.getByText('Private profile draft autosaved.',{exact:true})).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual({headline:'Clear pending skill resumes save',skills:['TypeScript','Rust'],withdrawal:false});
  await page.reload();
  await expect(headline).toHaveValue('Clear pending skill resumes save');
  await expect(auto).not.toBeChecked();
  await page.getByRole('button',{name:'Skills & links',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove Rust'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Remove Unadded skill'})).toHaveCount(0);
});


test('B16 C06 committed autosave with lost acknowledgement reconciles without second write',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires disposable local Supabase.');
  test.setTimeout(50_000);
  const owner=await localUser('S6 autosave lost ack');
  await signIn(page,owner);
  await page.goto('/app/profile');
  const headline=page.getByLabel('Headline',{exact:true});
  const auto=page.getByRole('checkbox',{name:'Autosave private profile fields'});
  await expect(headline).toBeVisible();
  let writes=0,committed=false;
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/owner_save_profile_draft',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    writes++;
    const input=route.request().postDataJSON();
    expect(input.p_confirm_projection_withdrawal).toBe(false);
    const result=await route.fetch();
    try{
      if(writes===1&&result.ok()){committed=true;await route.abort('failed');}
      else await route.fulfill({response:result});
    }finally{await result.dispose();}
  });
  await auto.check();
  await headline.fill('Committed but acknowledgement lost');
  const compare=page.getByRole('button',{name:'Compare latest saved profile'});
  await expect(compare).toBeEnabled();
  expect(committed).toBe(true);
  expect(writes).toBe(1);
  await expect(auto).not.toBeChecked();
  await expect(headline).toHaveValue('Committed but acknowledgement lost');
  await expect(page.getByRole('button',{name:'Save profile draft'})).toBeDisabled();
  await page.waitForTimeout(1500);
  expect(writes).toBe(1);
  await compare.click();
  await expect(page.getByText('Requested private draft is confirmed saved. No additional write was made.',{exact:true})).toBeVisible();
  expect(writes).toBe(1);
  await page.reload();
  await expect(headline).toHaveValue('Committed but acknowledgement lost');
  await expect(auto).not.toBeChecked();
});

test('B16 C04 real browser thumbnail bytes and independent server pin with owner denial',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires isolated local C04 migration and trusted writer.');
  test.setTimeout(90_000);
  const owner=await localUser('S6 C04 owner'),foreign=await localUser('S6 C04 foreign');
  const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY,service=process.env.KADMEION_TEST_SERVICE_ROLE_KEY;
  if(!key||!service||process.env.VITE_SUPABASE_URL!==origin)throw new Error('C04 requires disposable loopback credentials.');
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQSbn0HwAEJAJK6G06bAAAAABJRU5ErkJggg==','base64');
  const expected=createHash('sha256').update(bytes).digest('hex');
  await signIn(page,owner);
  await page.goto('/app/projects');
  await page.getByRole('button',{name:'Add first project'}).click();
  const drawer=page.getByRole('dialog',{name:'Add a project'});
  await drawer.getByLabel('Project title').fill('C04 pin browser fixture');
  await drawer.getByRole('button',{name:'Save project'}).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('link',{name:'C04 pin browser fixture'}).click();
  await expect(page.getByRole('heading',{name:'Build the case study.'})).toBeVisible();
  const projectId=new URL(page.url()).pathname.split('/').at(-1)!;
  const cover=page.getByRole('region',{name:'Project thumbnail'});
  const file=cover.getByLabel(/Image file/),alt=cover.getByLabel('Image alt text');
  await expect(file).toBeEnabled();
  await expect(alt).toBeEnabled();
  await file.setInputFiles({name:'c04.png',mimeType:'image/png',buffer:bytes});
  await alt.fill('C04 synthetic preview');
  const attach=cover.getByRole('button',{name:'Upload and attach thumbnail'});
  await expect(attach).toBeEnabled();
  await attach.click();
  const image=cover.getByRole('img',{name:'C04 synthetic preview',exact:true});
  const checkPreview=async()=>{
    await expect(image).toBeVisible();
    await expect.poll(()=>image.evaluate(async(element,expectedBytes)=>{
      const img=element as HTMLImageElement;
      if(!img.complete||!img.naturalWidth||!img.src.startsWith('blob:'))return false;
      const response=await fetch(img.src);
      const actual=new Uint8Array(await response.arrayBuffer());
      return response.ok&&response.headers.get('content-type')==='image/png'&&
        actual.length===expectedBytes.length&&actual.every((byte,i)=>byte===expectedBytes[i]);
    },Array.from(bytes))).toBe(true);
  };
  await checkPreview();
  function makePort(){
    const data=new Map<string,string>();
    return new SupabaseBrowserAuthPort({supabaseUrl:origin,publishableKey:key!,appOrigin:new URL(page.url()).origin,
      storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);}}});
  }
  const port=makePort();
  const session=await port.signInWithPassword({email:owner.email,password:owner.password});
  if(session.error||!session.data?.session?.access_token)throw new Error('Local owner session not verified.');
  const assets=await port.listOwnerAssets();
  const item=assets.data?.find(asset=>asset.projectId===projectId&&asset.altText==='C04 synthetic preview');
  if(assets.error||!item)throw new Error('Browser-uploaded asset not registered.');
  const read=()=>port.readOwnerPrivateAsset(projectId,item.id,port.getOwnerSessionEpoch());
  const unpinned=await read();
  expect(unpinned.error).toBeNull();
  expect(unpinned.data?.serverAttestation).toBe('NOT_VERIFIED');
  expect(unpinned.data?.integrity.computedSha256).toBe(expected);
  expect(unpinned.data?.publicDeliveryAllowed).toBe(false);
  // Real trusted worker hashes Storage bytes independently; service credentials
  // remain in the Playwright runner, never the browser or test artifacts.
  const attestor=new PrivateServerAssetByteAttestor(origin,key,service);
  const attested=await attestor.attest(item.id,session.data.session.access_token);
  expect(attested.status).toBe('WRITE_ONCE_ATTESTED');
  const pinned=await read();
  expect(pinned.error).toBeNull();
  expect(pinned.data?.serverAttestation).toBe('SERVER_HASH_PINNED');
  expect(pinned.data?.integrity.computedSha256).toBe(expected);
  expect(pinned.data?.publicDeliveryAllowed).toBe(false);
  expect(Buffer.from(await pinned.data!.bytes.arrayBuffer()).equals(bytes)).toBe(true);
  await page.reload();
  await checkPreview();
  const other=makePort();
  const signed=await other.signInWithPassword({email:foreign.email,password:foreign.password});
  expect(!signed.error&&!!signed.data?.session).toBe(true);
  const denied=await other.readOwnerPrivateAsset(projectId,item.id,other.getOwnerSessionEpoch());
  expect(denied.data).toBeNull();
  expect(!!denied.error).toBe(true);
});

test('B16 ordinary recovery rejects malformed provider acknowledgement and retries real GoTrue',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires disposable local Supabase and strict OWNER-AUTH policy.');
  test.setTimeout(60_000);
  const owner=await localUser('S6 recovery receipt');
  let mode:'rate'|'outage'|'transport'|'nonjson'|'null'|'unexpected'|'empty204'|'real'='rate';
  let calls=0,realReceipt=false;
  await page.route(url=>url.origin===origin&&url.pathname==='/auth/v1/recover',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    calls++;
    expect(route.request().postDataJSON().email===owner.email).toBe(true);
    expect(new URL(route.request().url()).searchParams.get('redirect_to')).toBe(new URL('/reset-password',page.url()).href);
    if(mode==='real'){
      const response=await route.fetch();
      try{realReceipt=response.status()===200&&JSON.stringify(await response.json())==='{}';
        await route.fulfill({response});
      }finally{await response.dispose();}
      return;
    }
    if(mode==='transport')return route.abort('failed');
    if(mode==='nonjson')return route.fulfill({status:200,contentType:'text/html',body:'S6_RAW_PROVIDER_MARKER'});
    if(mode==='null')return route.fulfill({status:200,contentType:'application/json',body:'null'});
    if(mode==='unexpected')return route.fulfill({status:200,json:{access_token:'S6_RAW_PROVIDER_MARKER'}});
    if(mode==='empty204')return route.fulfill({status:204});
    await route.fulfill({status:mode==='rate'?429:503,json:{message:'S6_RAW_PROVIDER_MARKER'}});
  });
  await page.goto('/forgot-password');
  await page.getByRole('textbox',{name:'Email address'}).fill(owner.email);
  const request=page.getByRole('button',{name:'Request recovery link'});
  for(const failure of ['rate','outage','transport','nonjson','null','unexpected','empty204'] as const){
    mode=failure;
    await request.click();
    await expect(page.getByRole('alert')).toContainText('Unable to submit the recovery request.');
    await expect(page.getByRole('heading',{name:'Reset your password.'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Check your inbox'})).toHaveCount(0);
    await expect(page.getByText('S6_RAW_PROVIDER_MARKER',{exact:false})).toHaveCount(0);
    await expect(page.getByRole('link',{name:'Open private workspace'})).toHaveCount(0);
    await expect(request).toBeEnabled();
  }
  expect(calls).toBe(7);
  mode='real';
  await request.click();
  await expect(page.getByRole('heading',{name:'Check your inbox'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Delivery is not confirmed.');
  expect(realReceipt).toBe(true);
  expect(calls).toBe(8);
  await page.goto('/app');
  await expect(page.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
  await expect(page.locator('.ws-shell')).toHaveCount(0);
});

test('B16 WF-043/047 Settings fail-closed gate retries actual session before privacy and inventory',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires disposable local Supabase.');
  test.setTimeout(70_000);
  const owner=await localUser('S6 Settings verification');
  await signIn(page,owner);
  let blocked=true,denials=0,verified=0,privateReadsWhileLocked=0;
  page.on('request',request=>{
    const url=new URL(request.url());
    if(blocked&&url.origin===origin&&url.pathname.startsWith('/rest/v1/'))privateReadsWhileLocked++;
  });
  await page.route(url=>url.origin===origin&&url.pathname==='/auth/v1/user',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    if(blocked){denials++;return route.abort('failed');}
    const response=await route.fetch();
    try{
      if(response.ok()){
        const user=await response.json().catch(()=>null);
        if(user?.id===owner.id)verified++;
      }
      await route.fulfill({response});
    }finally{await response.dispose();}
  });
  await page.goto('/app/settings');
  await expect(page.getByRole('heading',{name:'Owner verification unavailable.'})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('no private records are shown');
  await expect(page.getByRole('heading',{name:'Sign in required.'})).toHaveCount(0);
  await expect(page.locator('.ws-shell')).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);
  expect(denials).toBeGreaterThan(0);
  expect(privateReadsWhileLocked).toBe(0);
  blocked=false;
  await page.getByRole('button',{name:'Retry verification'}).click();
  await expect(page.getByRole('heading',{name:'Settings',level:1})).toBeVisible();
  expect(verified).toBeGreaterThan(0);
  await page.getByRole('link',{name:'Open privacy & sharing'}).click();
  await expect(page.getByRole('heading',{name:'Privacy & sharing',level:1})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save sharing preferences'})).toBeVisible();
  await expect(page.getByText('Loading sharing preferences…')).toHaveCount(0);
  await page.goto('/app/settings/account/delete');
  await expect(page.getByRole('heading',{name:'Account exit',level:1})).toBeVisible();
  await page.getByRole('button',{name:'Review deletion prerequisites'}).click();
  await expect(page.getByRole('heading',{name:'Private inventory',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Delete account/i})).toHaveCount(0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto('/app/settings/account/delete');
  await expect(page.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Private inventory',exact:true})).toHaveCount(0);
});

test('B16 C06 real profile autosave cannot silently withdraw existing projection',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires isolated local Supabase only.');
  test.setTimeout(60_000);
  const owner=await localUser('S6 withdrawal fixture');
  // Seed only a disposable trusted publication row, matching existing
  // consented-public-delivery SQL fixtures. This is not a hosted publish.
  const handle=runLocalFixtureSql(
    "update public.profiles set handle='s6_'||substr(replace(:'actor_id','-',''),1,12),headline='Old public headline' where user_id=:'actor_id'::uuid;"+
    "insert into kadmeion_private.profile_publications(user_id,handle,display_name,headline,bio) "+
    "select user_id,handle,display_name,headline,bio from public.profiles where user_id=:'actor_id'::uuid;"+
    "select handle from public.profiles where user_id=:'actor_id'::uuid;",owner.id);
  expect(/^s6_[0-9a-f]{12}$/.test(handle)).toBe(true);
  const projected=()=>runLocalFixtureSql(
    "select coalesce(public.service_read_published_profile_projection((select handle from public.profiles where user_id=:'actor_id'::uuid))->>'headline','ABSENT');",owner.id);
  expect(projected()).toBe('Old public headline');
  await signIn(page,owner);
  await page.goto('/app/profile');
  const headline=page.getByLabel('Headline',{exact:true});
  const auto=page.getByRole('checkbox',{name:'Autosave private profile fields'});
  await expect(headline).toHaveValue('Old public headline');
  const writes:boolean[]=[];
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/owner_save_profile_draft',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    writes.push(route.request().postDataJSON().p_confirm_projection_withdrawal);
    await route.continue();
  });
  await auto.check();
  await headline.fill('New private headline');
  const confirm=page.getByRole('checkbox',{name:'Withdraw my current public profile when I save this draft'});
  await expect(confirm).toBeVisible();
  await expect(confirm).not.toBeChecked();
  await expect(auto).not.toBeChecked();
  expect(writes).toEqual([false]);
  expect(projected()).toBe('Old public headline');
  await expect(headline).toHaveValue('New private headline');
  await confirm.check();
  await page.getByRole('button',{name:'Save profile draft'}).click();
  await expect(page.getByText('Private profile draft saved.',{exact:true})).toBeVisible();
  expect(writes).toEqual([false,true]);
  expect(projected()).toBe('ABSENT');
  await page.reload();
  await expect(headline).toHaveValue('New private headline');
  await expect(auto).not.toBeChecked();
});


test('B16 C10 mounted scoped theme transaction, measured canvas and private ZIP persistence',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires real mounted R4 editor and disposable local Supabase.');
  test.setTimeout(95_000);
  const owner=await localUser('S6 mounted scoped theme');
  await page.setViewportSize({width:2200,height:1100});
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('S6 mounted scoped fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'S6 mounted scoped fixture',level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  await page.getByRole('button',{name:'Theme',exact:true}).click();
  // Fresh preset snapshots intentionally contain no persisted theme file.
  // The visible palette defaults are not proof of an initialized theme.
  const initialize=page.getByRole('button',{name:'Initialize global palette',exact:true});
  await expect(initialize).toBeEnabled();
  await initialize.click();
  await expect(initialize).toHaveCount(0);
  await page.getByLabel('Portfolio theme').selectOption('light');
  const scope=page.getByRole('region',{name:'Scoped theme overrides'});
  const token=scope.getByLabel('Theme token'),layer=scope.getByLabel('Override layer');
  const value=scope.getByLabel('Override value');
  async function set(scopeId:string,bucket:string,color:string){
    // Implicit label includes the option text in Playwright's exact label query.
    // Scope by the named panel and the visible label wrapper, then assert the
    // actual select's accessibility and selected value. No skipped UI action.
    const scopeSelect=scope.locator('label').filter({hasText:/^Scope/}).getByRole('combobox');
    await expect(scopeSelect).toHaveCount(1);
    await expect(scopeSelect).toHaveAccessibleName(/Scope/);
    await scopeSelect.selectOption(scopeId,{timeout:10_000});
    await expect(scopeSelect).toHaveValue(scopeId);
    await layer.selectOption(bucket);
    await token.selectOption('text');
    await expect(value).toBeEnabled({timeout:10_000});
    await value.fill(color,{timeout:10_000});
    await scope.getByRole('button',{name:'Apply override',exact:true}).click();
    await expect(scope.getByText('Override applied to the working draft. Save to persist, or use Undo.',{exact:true})).toBeVisible();
    await expect(value).toHaveValue(color);
  }
  await set('global','base','#112233');
  await set('section:arc-hero','base','#334455');
  await set('component:arc-hero-title','phone','#224466');
  await set('component:arc-hero-title','desktop','#663344');
  const canvas=page.locator('.ws-studio-editor .k-theme-container');
  const title=canvas.getByRole('button',{name:/^Edit L1 title slot in preview/});
  const measure=()=>canvas.evaluate(node=>node.getBoundingClientRect().width);
  await page.getByLabel('Preview width').selectOption('390');
  await expect.poll(measure).toBeLessThanOrEqual(600);
  await expect(title).toHaveCSS('color','rgb(34, 68, 102)');
  await page.getByLabel('Preview width').selectOption('1440');
  await expect.poll(measure).toBeGreaterThan(950);
  await expect(title).toHaveCSS('color','rgb(102, 51, 68)');
  await scope.getByRole('button',{name:'Reset selected override'}).click();
  await expect(title).toHaveCSS('color','rgb(51, 68, 85)');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(title).toHaveCSS('color','rgb(102, 51, 68)');
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect(title).toHaveCSS('color','rgb(51, 68, 85)');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(title).toHaveCSS('color','rgb(102, 51, 68)');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'Theme',exact:true}).click();
  await page.getByLabel('Preview width').selectOption('390');
  await expect(title).toHaveCSS('color','rgb(34, 68, 102)');
  await page.getByLabel('Preview width').selectOption('1440');
  await expect(title).toHaveCSS('color','rgb(102, 51, 68)');
  await page.goto('/app/export');
  await page.getByLabel('Portfolio to export').selectOption(editorPath.split('/')[3]!);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download portfolio source ZIP'}).click()]);
  const downloadedPath=await download.path();if(!downloadedPath)throw new Error('Private source export absent.');
  const snapshot=importPortfolioSourceZip(new Uint8Array(await readFile(downloadedPath)));
  const {resolveScopedTheme}=await import('../../../packages/editor-core/src/index.ts');
  for(const [widthPx,text] of [[390,'#224466'],[768,'#334455'],[1440,'#663344']] as const){
    const resolved=resolveScopedTheme(snapshot,{mode:'light',sectionId:'arc-hero',slotKey:'arc-hero-title',widthPx});
    expect(resolved.status).toBe('resolved');expect(resolved.tokens.text).toBe(text);
  }
});

test('B16 WF-044/048 real owner verification distinguishes transport outage from session denial',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires isolated Supabase and S14 truthful verification gate.');
  test.setTimeout(65_000);
  const owner=await localUser('S6 transport versus denial');
  await signIn(page,owner);
  let mode:'transport'|'real'|'deny'='transport',privateWhileClosed=0,denials=0;
  page.on('request',request=>{
    const u=new URL(request.url());
    if(mode!=='real'&&u.origin===origin&&u.pathname.startsWith('/rest/v1/'))privateWhileClosed++;
  });
  await page.route(url=>url.origin===origin&&url.pathname==='/auth/v1/user',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    if(mode==='transport')return route.abort('failed');
    if(mode==='deny'){denials++;return route.fulfill({status:401,json:{message:'S6 disposable fixture denial'}});}
    await route.continue();
  });
  await page.goto('/app/settings');
  await expect(page.getByRole('heading',{name:'Owner verification unavailable.'})).toBeVisible();
  await expect(page.locator('.ws-shell')).toHaveCount(0);
  expect(privateWhileClosed).toBe(0);
  mode='real';
  await page.getByRole('button',{name:'Retry verification'}).click();
  await expect(page.getByRole('heading',{name:'Settings',level:1})).toBeVisible();
  mode='deny';
  await page.goto('/app/settings/security');
  await expect(page.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Owner verification unavailable.'})).toHaveCount(0);
  await expect(page.locator('.ws-shell')).toHaveCount(0);
  expect(denials).toBeGreaterThan(0);expect(privateWhileClosed).toBe(0);
  mode='real';
  await page.getByRole('button',{name:'Retry verification'}).click();
  await expect(page.getByRole('heading',{name:'Sign in required.'})).toBeVisible();
  await expect(page.locator('.ws-shell')).toHaveCount(0);
  await signIn(page,owner);
  await page.goto('/app/settings/security');
  await expect(page.getByRole('heading',{name:'Account security'})).toBeVisible();
});

test('B16 C06 real A-B-A owner transition rejects delayed autosave acknowledgement',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Isolated local Supabase; requires latest S2 owner epoch and S1 verified session guard.');
  test.setTimeout(85_000);
  const owner=await localUser('S6 autosave epoch A'),other=await localUser('S6 autosave epoch B');
  await signIn(page,owner);await page.goto('/app/profile');
  const name=page.getByLabel('Display name',{exact:true});
  const headline=page.getByLabel('Headline',{exact:true});
  const auto=page.getByRole('checkbox',{name:'Autosave private profile fields'});
  await expect(name).toHaveValue('S6 autosave epoch A');
  let accept!:()=>void,received!:()=>void,finished!:()=>void;
  const hold=new Promise<void>(r=>{accept=r}),ack=new Promise<void>(r=>{received=r}),settled=new Promise<void>(r=>{finished=r});
  let saves=0,committed=false;
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/owner_save_profile_draft',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    saves++;
    if(saves!==1)return route.continue();
    const body=route.request().postDataJSON();
    expect(body.p_draft.headline).toBe('A committed before epoch switch');
    expect(body.p_confirm_projection_withdrawal).toBe(false);
    const result=await route.fetch();
    try{
      committed=result.ok();received();await hold;
      // The earlier request may already have been aborted on owner remount.
      await route.fulfill({response:result}).catch(()=>{});
    }finally{await result.dispose();finished();}
  });
  const control=await page.context().newPage();
  try{
    await auto.check();await headline.fill('A committed before epoch switch');await ack;
    expect(committed).toBe(true);expect(saves).toBe(1);
    await control.goto('/app/settings');
    await control.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(control).toHaveURL(/\/signin$/);
    await expect(page.locator('.ws-shell')).toHaveCount(0);
    await expect(name).toHaveCount(0);
    await signIn(control,other);
    await expect(name).toHaveValue('S6 autosave epoch B');
    await expect(headline).toHaveValue('');
    await expect(auto).not.toBeChecked();
    await expect(page.getByText('A committed before epoch switch',{exact:true})).toHaveCount(0);
    await control.goto('/app/settings');
    await control.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(control).toHaveURL(/\/signin$/);
    await signIn(control,owner);
    await expect(name).toHaveValue('S6 autosave epoch A');
    await expect(headline).toHaveValue('A committed before epoch switch');
    await expect(auto).not.toBeChecked();
    await headline.fill('New A unsaved buffer');
    accept();await settled;
    await expect(headline).toHaveValue('New A unsaved buffer');
    await expect(page.getByText('Private profile draft autosaved.',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Save profile draft'})).toBeEnabled();
    expect(saves).toBe(1);
    await page.getByRole('button',{name:'Save profile draft'}).click();
    await expect(page.getByText('Private profile draft saved.',{exact:true})).toBeVisible();
    expect(saves).toBe(2);
    await page.reload();await expect(headline).toHaveValue('New A unsaved buffer');
  }finally{accept();await control.close();}
});

test('B16 WF-048 offline owner verification retries in place without cached authority or private reads',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable Supabase and S14 truthful gate required.');
  test.setTimeout(65_000);
  const owner=await localUser('S6 true offline verification');
  await signIn(page,owner);
  let fail=true,verifications=0,privateReads=0,verified=false;
  page.on('request',req=>{
    const u=new URL(req.url());
    if(!verified&&u.origin===origin&&u.pathname.startsWith('/rest/v1/'))privateReads++;
  });
  await page.route(url=>url.origin===origin&&url.pathname==='/auth/v1/user',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    verifications++;
    if(fail)return route.abort('failed');
    const response=await route.fetch();
    try{
      if(response.ok()){
        const result=await response.json();
        if(result?.id===owner.id)verified=true;
      }
      await route.fulfill({response});
    }finally{await response.dispose();}
  });
  await page.goto('/app/settings');
  const unavailable=page.getByRole('heading',{name:'Owner verification unavailable.'});
  const retry=page.getByRole('button',{name:'Retry verification'});
  await expect(unavailable).toBeVisible();
  await expect(page.locator('.ws-shell')).toHaveCount(0);
  expect(privateReads).toBe(0);
  const before=verifications;
  await page.context().setOffline(true);
  try{
    await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);
    await retry.click();
    await expect(page.getByRole('alert')).toContainText('Your browser reports offline.');
    await expect(unavailable).toBeVisible();
    await expect(page.locator('.ws-shell')).toHaveCount(0);
    expect(verifications).toBe(before);expect(privateReads).toBe(0);
  }finally{await page.context().setOffline(false);}
  await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(true);
  await expect(unavailable).toBeVisible();await expect(page.locator('.ws-shell')).toHaveCount(0);
  fail=false;
  await retry.click();
  await expect(page.getByRole('heading',{name:'Settings',level:1})).toBeVisible();
  expect(verified).toBe(true);expect(privateReads).toBe(0);
  await expect(page.locator('#ws-content')).toBeFocused();
});


test('B16 release pending glyph reflects real owner read, failure and explicit recovery',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires S4 release pending UI and disposable local Supabase.');
  test.setTimeout(75_000);
  const owner=await localUser('S6 release pending');
  await signIn(page,owner);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('S6 release pending fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'S6 release pending fixture',level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  const portfolioId=editorPath.split('/').find(segment=>/^[0-9a-f-]{36}$/i.test(segment));
  if(!portfolioId)throw new Error('Local portfolio ID missing.');
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  let failure=true,heldReads=0;
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/portfolios'&&url.searchParams.get('id')==='eq.'+portfolioId,async route=>{
    if(route.request().method()!=='GET')return route.continue();
    if(failure){heldReads++;await held;return route.fulfill({status:503,json:{message:'S6 simulated release read outage'}});}
    await route.continue();
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  const section=page.locator('.ws-release-page');
  try{
    await page.goto(editorPath.replace('/edit','/staging'),{waitUntil:'domcontentloaded'});
    await expect(section.getByRole('status').filter({hasText:'Loading private release details…'})).toBeVisible();
    // The loading glyph can render before verified owner transport dispatches its read.
    await expect.poll(()=>heldReads,{timeout:10_000}).toBeGreaterThan(0);
    const glyph=section.locator('.glyph-skeleton[aria-hidden="true"]');
    await expect(glyph).toHaveCount(1);
    await expect(glyph.locator('a,button,input,select,textarea,[tabindex="0"]')).toHaveCount(0);
    await expect(section.locator('.ws-release-visual-canvas')).toHaveCount(0);
    await expect(section.getByRole('button',{name:'Freeze private revision'})).toHaveCount(0);
  }finally{release();}
  await expect(section.getByRole('alert')).toBeVisible();
  await expect(section.locator('.glyph-skeleton')).toHaveCount(0);
  await expect(section.locator('.ws-release-visual-canvas')).toHaveCount(0);
  failure=false;
  await section.getByRole('button',{name:'Retry private release check'}).click();
  await expect(section.locator('.ws-release-visual-canvas')).toBeVisible();
  await expect(section.getByRole('button',{name:'Freeze private revision'})).toBeEnabled();
  await expect(section.getByRole('button',{name:'Copy public link unavailable'})).toBeDisabled();
  await expect(section.getByRole('status').filter({hasText:'Loading private release details…'})).toHaveCount(0);
});

test('B16 WF-018 all five curated presets and genuine Blank persist exact authored skeletons',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase and mounted private editor only.');
  test.setTimeout(140_000);
  await page.setViewportSize({width:1600,height:1000});
  const owner=await localUser('S6 all preset fixtures');
  await signIn(page,owner);
  const cases=[
    ['Arc','arc',['arc-hero@1','project-showcase@1','editorial-bento@1','skills@1','contact@1']],
    ['Collage','collage',['collage-hero@1','project-showcase@1','experience@1','contact@1']],
    ['Editorial','editorial',['editorial-bento@1','project-showcase@1','skills@1','contact@1']],
    ['Stairs','stairs',['stepped-hero@1','editorial-bento@1','project-showcase@1','contact@1']],
    ['Studio','studio',['arc-hero@1','project-showcase@1','experience@1','skills@1','contact@1']],
    ['Blank','blank',[]]
  ] as const;
  const ids:string[]=[];
  for(const [label,preset,layouts] of cases){
    await page.goto('/app/portfolios/new');
    await page.getByRole('radio',{name:label,exact:true}).check();
    await expect(page.getByRole('group',{name:'Selected layout preview'}).getByRole('heading',{name:label,exact:true})).toBeVisible();
    const title='S6 '+label+' skeleton fixture';
    await page.getByLabel('Portfolio name').fill(title);
    await page.getByRole('button',{name:'Choose template and create draft'}).click();
    await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();
    const id=new URL(page.url()).pathname.split('/')[3]!;
    expect(/^[0-9a-f-]{36}$/i.test(id)).toBe(true);
    ids.push(id);
    if(preset==='blank'){
      await expect(page.getByText('This blank draft has no slots.',{exact:true})).toBeVisible();
      await expect(page.getByText('No authored sections yet.',{exact:true})).toBeVisible();
    }
    await page.goto('/app/export');
    await page.getByLabel('Portfolio to export').selectOption(id,{timeout:10_000});
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download portfolio source ZIP'}).click()]);
    const downloaded=await download.path();if(!downloaded)throw new Error('Verified private export unavailable.');
    const snapshot=importPortfolioSourceZip(new Uint8Array(await readFile(downloaded)));
    expect(JSON.parse(snapshot.files['kadmeion.json']).preset).toBe(preset);
    const document=JSON.parse(snapshot.files['pages/home.page.json']);
    expect(document.sections.map((section:{layout:string})=>section.layout)).toEqual(layouts);
    expect(Object.values(snapshot.slots).every(slot=>Object.keys(slot.content).length===0)).toBe(true);
    if(preset==='blank'){
      expect(document.header).toBeNull();
      expect(Object.keys(snapshot.slots)).toHaveLength(0);
    }
  }
  expect(new Set(ids).size).toBe(cases.length);
});

test('unmounted private analytics stays consent-off without collection after owner navigation and reload',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires isolated Supabase CI.');
  test.setTimeout(90_000);
  const owner=await localUser('CI Analytics Consent Off');
  await page.goto('/app/analytics');
  await expect(page.locator('.ws-shell')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Enable portfolio analytics'})).toHaveCount(0);
  await signIn(page,owner);
  const appOrigin=new URL(page.url()).origin;
  const observed:{classification:string;count:number}[]=[
    {classification:'analytics endpoint',count:0},{classification:'external HTTP',count:0}
  ];
  page.on('request',request=>{
    const url=new URL(request.url());
    if(!['http:','https:'].includes(url.protocol))return;
    if(/analytics|telemetry|tracking|collect_event/i.test(url.pathname)&&
      !(url.origin===appOrigin&&url.pathname==='/app/analytics'))observed[0].count++;
    if(url.origin!==appOrigin&&url.origin!==origin)observed[1].count++;
  });
  await page.goto('/app/analytics');
  const verifyOff=async()=>{
    await expect(page.getByRole('heading',{name:'Tracking remains off.'})).toBeVisible();
    await expect(page.getByText('No verified visitor analytics are available.')).toBeVisible();
    await expect(page.getByRole('button',{name:'Enable portfolio analytics'})).toBeDisabled();
    await expect(page.getByRole('link',{name:'Manage private portfolios'})).toBeVisible();
  };
  await verifyOff();
  await page.reload();
  await verifyOff();
  await page.getByRole('link',{name:'Manage private portfolios'}).click();
  await expect(page).toHaveURL(/\/app\/portfolios(?:[?#].*)?$/);
  expect(observed).toEqual([{classification:'analytics endpoint',count:0},{classification:'external HTTP',count:0}]);
});

test('B16 WF-001/002 R6 core registration creates exactly one owner and durable private profile without mailbox dependency',async({page,browser})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Actual loopback GoTrue and PostgREST only.');
  test.setTimeout(100_000);
  const credentials={email:'r6-core-'+randomUUID()+'@testing.invalid',password:'LocalFixture!'+randomUUID()};
  const handle='r6_'+randomUUID().slice(0,8),displayName='R6 registered owner';
  const appUrl='http://127.0.0.1:5173';
  let ownerId:string|null=null,signupPosts=0,verifiedReads=0;
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.origin===origin&&url.pathname==='/auth/v1/signup'&&request.method()==='POST')signupPosts++;
  });
  page.on('response',async response=>{
    const url=new URL(response.url());
    if(url.origin!==origin||url.pathname!=='/auth/v1/user'||!response.ok())return;
    const value=await response.json().catch(()=>null);
    if(typeof value?.id==='string'&&/^[0-9a-f-]{36}$/i.test(value.id)){
      ownerId=value.id;verifiedReads++;
    }
  });
  // No admin-created signup fixture: complete the mounted form with a new email.
  await page.goto('/signup');
  await page.getByLabel('Display name',{exact:true}).fill(displayName);
  await page.getByLabel('Preferred handle',{exact:true}).fill(handle);
  await page.getByLabel('Email address',{exact:true}).fill(credentials.email);
  await page.getByLabel('Create password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Confirm password',{exact:true}).fill(credentials.password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading',{name:'A place for what you build next.'})).toBeVisible();
  await expect.poll(()=>verifiedReads).toBeGreaterThan(0);
  expect(signupPosts).toBe(1);
  if(!ownerId)throw new Error('No verified signup owner.');
  const id:string=ownerId;
  const bootstrap=runLocalFixtureSql("select (select count(*) from auth.users where id=:'actor_id'::uuid)||':'||(select count(*) from public.profiles where user_id=:'actor_id'::uuid);",id);
  expect(bootstrap).toBe('1:1');
  await page.goto('/app/profile');
  await expect(page.getByLabel('Display name',{exact:true})).toHaveValue(displayName);
  const headline='R6 private durable headline';
  await page.getByLabel('Headline',{exact:true}).fill(headline);
  await page.getByRole('button',{name:'Save profile draft',exact:true}).click();
  await expect(page.getByText('Private profile draft saved.',{exact:true})).toBeVisible();
  expect(runLocalFixtureSql("select headline from public.profiles where user_id=:'actor_id'::uuid;",id)).toBe(headline);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);
  const fresh=await browser.newPage({baseURL:appUrl});
  try{
    await fresh.goto('/signin');
    await fresh.getByLabel('Email address').fill(credentials.email);
    await fresh.locator('#signin-password').fill('Incorrect!'+randomUUID());
    const denial=fresh.waitForResponse(r=>new URL(r.url()).origin===origin&&new URL(r.url()).pathname==='/auth/v1/token'&&r.request().method()==='POST');
    await fresh.getByRole('button',{name:'Sign in',exact:true}).click();
    expect((await denial).ok()).toBe(false);
    await expect(fresh.getByRole('alert')).toContainText('Incorrect credentials or sign-in unavailable.');
    await fresh.goto('/app/profile');
    await expect(fresh.locator('.ws-shell')).toHaveCount(0);
    await expect(fresh.getByLabel('Headline',{exact:true})).toHaveCount(0);
    await signIn(fresh,credentials);
    await fresh.goto('/app/profile');
    await expect(fresh.getByLabel('Display name',{exact:true})).toHaveValue(displayName);
    await expect(fresh.getByLabel('Headline',{exact:true})).toHaveValue(headline);
    await fresh.reload();
    await expect(fresh.getByLabel('Headline',{exact:true})).toHaveValue(headline);
    await fresh.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(fresh).toHaveURL(/\/signin$/);
  }finally{await fresh.close();}
  expect(runLocalFixtureSql("select (select count(*) from auth.users where id=:'actor_id'::uuid)||':'||(select count(*) from public.profiles where user_id=:'actor_id'::uuid);",id)).toBe('1:1');
});

test('B16 C05 mounted private avatar real bytes, lost attach ACK, reload, foreign denial and detach',async({page,browser})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Requires disposable local C05 SQL and real mounted avatar consumer.');
  test.setTimeout(90_000);
  const owner=await localUser('S6 avatar owner'),other=await localUser('S6 avatar foreign');
  const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!key||process.env.VITE_SUPABASE_URL!==origin)throw new Error('C05 requires disposable loopback credentials.');
  const firstBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQSbn0HwAEJAJK6G06bAAAAABJRU5ErkJggg==','base64');
  const secondBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpH7DwABpAE8k4sOtwAAAABJRU5ErkJggg==','base64');
  await signIn(page,owner);
  await page.goto('/app/profile');
  const avatar=page.getByRole('region',{name:'Private profile avatar'});
  const file=avatar.getByLabel(/Avatar image/),alt=avatar.getByLabel('Avatar alt text');
  await expect(file).toBeEnabled();
  await expect(avatar.getByText('Saved avatar revision 0 · No selected image',{exact:true})).toBeVisible();
  const ids:string[]=[];let lost=false,dropNext=false,storageRead:string|null=null;
  page.on('response',response=>{
    const url=new URL(response.url());
    if(url.origin===origin&&url.pathname.includes('/storage/v1/object/')&&url.pathname.includes('/profile/')&&
       response.ok()&&response.request().method()==='GET')storageRead=url.pathname;
  });
  await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/set_private_profile_avatar',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const request=route.request().postDataJSON();
    if(typeof request.p_asset_id==='string')ids.push(request.p_asset_id);
    if(!dropNext)return route.continue();
    dropNext=false;const result=await route.fetch();
    try{if(result.ok()){lost=true;await route.abort('failed');}else await route.fulfill({response:result});}
    finally{await result.dispose();}
  });
  const choose=async(bytes:Buffer,name:string)=>{
    await file.setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:bytes});
    await alt.fill(name);
    await avatar.getByRole('button',{name:'Save private avatar'}).click();
  };
  const check=async(bytes:Buffer,name:string)=>{
    const image=avatar.getByRole('img',{name,exact:true});
    await expect(image).toBeVisible();
    await expect.poll(()=>image.evaluate(async(node,expected)=>{
      const img=node as HTMLImageElement;
      if(!img.complete||!img.naturalWidth||!img.src.startsWith('blob:'))return false;
      const response=await fetch(img.src);
      const actual=new Uint8Array(await response.arrayBuffer());
      return response.ok&&actual.length===expected.length&&actual.every((byte,i)=>byte===expected[i]);
    },Array.from(bytes))).toBe(true);
  };
  await choose(firstBytes,'First private avatar');
  await expect(avatar.getByText('Private avatar selection saved. Not published.',{exact:true})).toBeVisible();
  await check(firstBytes,'First private avatar');
  await expect(file).toBeEnabled();
  const retiredUrl=await avatar.getByRole('img',{name:'First private avatar'}).getAttribute('src');
  dropNext=true;await choose(secondBytes,'Replacement private avatar');
  await expect(avatar.getByRole('button',{name:'Check saved avatar selection'})).toBeEnabled();
  expect(lost).toBe(true);expect(ids.length).toBe(2);expect(ids[0]!==ids[1]).toBe(true);
  await avatar.getByRole('button',{name:'Check saved avatar selection'}).click();
  await expect(avatar.getByText('Requested avatar matches the current saved selection. No additional write was made.',{exact:true})).toBeVisible();
  await check(secondBytes,'Replacement private avatar');
  expect(ids.length).toBe(2);
  if(!retiredUrl)throw new Error('Old private image object URL missing.');
  expect(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},retiredUrl)).toBe(true);
  await page.reload();await check(secondBytes,'Replacement private avatar');
  expect(storageRead!==null).toBe(true);
  const isolated=await browser.newPage({baseURL:new URL(page.url()).origin});
  try{
    await signIn(isolated,other);await isolated.goto('/app/profile');
    const foreign=isolated.getByRole('region',{name:'Private profile avatar'});
    await expect(foreign.getByText('Saved avatar revision 0 · No selected image',{exact:true})).toBeVisible();
    await expect(foreign.getByRole('img',{name:'Replacement private avatar'})).toHaveCount(0);
    const signed=await fetch(origin+'/auth/v1/token?grant_type=password',{method:'POST',
      headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:other.email,password:other.password})});
    if(!signed.ok)throw new Error('Local foreign owner authentication failed.');
    const receipt=await signed.json();
    if(typeof receipt.access_token!=='string')throw new Error('Local foreign owner token absent.');
    const leak=await fetch(origin+storageRead!,{headers:{apikey:key,Authorization:'Bearer '+receipt.access_token},redirect:'error'});
    expect(leak.ok).toBe(false);expect([400,401,403,404]).toContain(leak.status);await leak.body?.cancel();
  }finally{await isolated.close();}
  const remove=avatar.getByRole('button',{name:'Remove avatar selection'});
  await expect(remove).toBeDisabled();
  await avatar.getByRole('checkbox',{name:/Detach current avatar/}).check();await remove.click();
  await expect(avatar.getByText('Avatar detached. Stored private assets have not been permanently deleted.',{exact:true})).toBeVisible();
  await expect(avatar.getByRole('img')).toHaveCount(0);
  await page.reload();await expect(avatar.getByText(/Saved avatar revision 3 · No selected image/)).toBeVisible();
});

test('B16 WF-020/021/023/025 R5 native pinned placement, EMPTY undo, device favorites and section reorder persist',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase and paired S3/S7 placement panel required.');
  test.setTimeout(115_000);
  const owner=await localUser('S6 R5 placement owner');
  await page.setViewportSize({width:2200,height:1500});
  await signIn(page,owner);await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Arc',exact:true}).check();
  await page.getByLabel('Portfolio name').fill('S6 native placement fixture');
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:'S6 native placement fixture',level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  await page.getByRole('button',{name:/arc hero title Starter/i}).click();
  await page.getByLabel('Text content').fill('R5 preserved outgoing title');
  await page.getByRole('button',{name:'Apply text',exact:true}).click();
  await page.getByRole('button',{name:'Components',exact:true}).click();
  await page.getByText('Component placement, Favorites and ordering',{exact:true}).click();
  const board=page.getByRole('region',{name:'Pinned component placement'});
  const order=page.getByRole('region',{name:'Section ordering controls'});
  const target=board.getByRole('combobox',{name:'Placement target',exact:true});
  const heading=board.getByRole('button',{name:'Heading · title-stacked@1',exact:true});
  const empty=board.getByRole('button',{name:'L1 · title (arc-hero) · EMPTY',exact:true});
  const starter=board.getByRole('button',{name:'L1 · title (arc-hero) · S0',exact:true});
  await target.selectOption('arc-hero-title');
  await board.getByRole('button',{name:'Favorite · Heading',exact:true}).click();
  await board.getByRole('checkbox',{name:'Device favorites only'}).check();
  await expect(heading).toBeVisible();
  await expect(board.getByRole('button',{name:'Paragraph · body-copy@1',exact:true})).toHaveCount(0);
  await board.getByRole('checkbox',{name:'Device favorites only'}).uncheck();
  await board.getByRole('button',{name:'Move selected assignment to Unplaced'}).click();
  const review=board.getByRole('region',{name:'Pinned placement impact'});
  await expect(review.getByRole('heading',{name:'Review placement impact'})).toBeFocused();
  await expect(starter).toBeVisible();
  await review.getByRole('button',{name:'Cancel placement review'}).click();
  await expect(starter).toBeVisible();
  await board.getByRole('button',{name:'Move selected assignment to Unplaced'}).click();
  await review.getByRole('button',{name:'Confirm move to Unplaced'}).click();
  await expect(empty).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(starter).toBeVisible();
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(empty).toBeVisible();
  // Exercise genuine browser drag events, not a fabricated transaction or serialized edit payload.
  // Keep both live controls in view; Chromium requires a second mouse move
  // over the destination to dispatch dragover reliably. Never synthesize Drop
  // or call the editor transaction from the test.
  await board.getByLabel('Search placement library').fill('title-stacked@1');
  await expect(heading).toHaveAttribute('draggable','true');
  await expect(heading).toBeEnabled();
  await expect(empty).toBeVisible();
  await heading.hover();
  await page.mouse.down();
  try{
    await empty.hover();
    await empty.hover();
    await expect(empty.locator('..')).toHaveAttribute('data-drop-fit','compatible');
  }finally{await page.mouse.up();}
  await expect(starter).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(empty).toBeVisible();
  // The keyboard-equivalent selection must use the same declared assignment transaction.
  await heading.focus();await heading.press('Enter');
  await target.selectOption('arc-hero-title');
  await board.getByRole('button',{name:'Place selected pinned block'}).press('Enter');
  await expect(starter).toBeVisible();
  await order.getByLabel('Section to move').selectOption('contact');
  await order.getByLabel('Move before').selectOption('arc-hero');
  await order.getByRole('button',{name:'Move section to chosen position'}).press('Enter');
  await expect(order.locator('ol li').first()).toContainText('contact');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(order.locator('ol li').first()).toContainText('arc-hero');
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect(order.locator('ol li').first()).toContainText('contact');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'Components',exact:true}).click();
  await page.getByText('Component placement, Favorites and ordering',{exact:true}).click();
  await expect(board.getByRole('button',{name:'Remove favorite · Heading',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(order.locator('ol li').first()).toContainText('contact');
  await page.goto('/app/export');
  await page.getByLabel('Portfolio to export').selectOption(editorPath.split('/')[3]!);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download portfolio source ZIP'}).click()]);
  const path=await download.path();if(!path)throw new Error('Private export missing.');
  const snapshot=importPortfolioSourceZip(new Uint8Array(await readFile(path)));
  expect(JSON.parse(snapshot.files['pages/home.page.json']).sections.map((row:{id:string})=>row.id))
    .toEqual(['contact','arc-hero','project-showcase','editorial-bento','skills']);
  expect(snapshot.slots['arc-hero-title']).toMatchObject({state:'S0',componentId:'title-stacked@1',content:{}});
  expect(JSON.stringify(snapshot.stashes['arc-hero-title'])).toContain('R5 preserved outgoing title');
  expect(Object.values(snapshot.files).join('')).not.toContain('Optional supporting text');
});

test('B16 WF-019/027 R6 cold browser profile preserves individual editor transaction history',async()=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local GoTrue only; actual persistent Chromium process restart.');
  test.setTimeout(150_000);
  const owner=await localUser('R6 cold history owner');
  const profile=await mkdtemp(join(tmpdir(),'kadmeion-s6-cold-profile-'));
  const start=()=>chromium.launchPersistentContext(profile,{
    executablePath:process.env.KADMEION_CHROME_PATH||'/usr/bin/google-chrome',
    headless:true,baseURL:'http://127.0.0.1:5173',viewport:{width:1600,height:1000}
  });
  let context:BrowserContext|null=null;
  const saved='R6 cold saved',first='R6 first independent transaction',second='R6 second independent transaction';
  const title='R6 cold recovery portfolio';
  let editorPath='';
  try{
    context=await start();let page=context.pages()[0]??await context.newPage();
    await signIn(page,owner);
    await page.goto('/app/portfolios/new');
    await page.getByRole('radio',{name:'Arc',exact:true}).check();
    await page.getByLabel('Portfolio name').fill(title);
    await page.getByRole('button',{name:'Choose template and create draft'}).click();
    await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();
    editorPath=new URL(page.url()).pathname;
    const field=()=>page.getByLabel('Text content');
    const apply=async(value:string)=>{
      await field().fill(value);
      await page.getByRole('button',{name:'Apply text',exact:true}).click();
      await expect(field()).toHaveValue(value);
    };
    const undo=()=>page.getByRole('button',{name:'Undo',exact:true});
    const redo=()=>page.getByRole('button',{name:'Redo',exact:true});
    await apply(saved);await page.getByRole('button',{name:'Save draft',exact:true}).click();
    await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
    await apply(first);await apply(second);
    await undo().click();await expect(field()).toHaveValue(first);
    await redo().click();await expect(field()).toHaveValue(second);
    const details=()=>page.locator('details.ws-editor-safety').filter({hasText:'Browser recovery & Keep Both'});
    const expand=async()=>{
      await expect(details()).toBeVisible();
      if(await details().getAttribute('open')===null)await details().locator('summary').click();
    };
    await expand();
    await details().getByRole('button',{name:'Save browser recovery copy',exact:true}).click();
    await expect(details().getByText('Recovery copy saved on this browser only. Cloud draft unchanged.',{exact:true})).toBeVisible();
    await expect(details().getByRole('button',{name:'Open recovery copy',exact:true})).toHaveCount(1);
    // Actual Chrome exit. No storage-state export, IDB injection, mocked auth, or page.reload substitute.
    await context.close();context=null;
    context=await start();page=context.pages()[0]??await context.newPage();
    await page.goto(editorPath);
    await expect(page.getByRole('heading',{name:title,level:1})).toBeVisible();
    await expect(field()).toHaveValue(saved);
    await expand();
    await details().getByRole('button',{name:'Open recovery copy',exact:true}).click();
    await expect(details().getByText('Recovery copy opened as an unsaved working draft. Original copy and cloud revision unchanged.',{exact:true})).toBeVisible();
    await expect(field()).toHaveValue(second);
    // Snapshot-only restore would jump directly to saved; that is not persistent history (UI-054).
    await undo().click();await expect(field(),'cold restart must restore preceding individual edit, not just the saved snapshot').toHaveValue(first);
    await undo().click();await expect(field()).toHaveValue(saved);
    await redo().click();await expect(field()).toHaveValue(first);
    await redo().click();await expect(field()).toHaveValue(second);
    await page.getByRole('button',{name:'Save draft',exact:true}).click();
    await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
    await page.reload();
    await expect(field()).toHaveValue(second);
  }finally{
    await context?.close().catch(()=>undefined);
    await rm(profile,{recursive:true,force:true});
  }
});

test('B16 C08 profile field selection CAS conflicts across tabs and withdraws the actual local projection',async({page,browser})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only; no hosted publication.');
  test.setTimeout(120_000);
  const owner=await localUser('R6 selected-field owner');
  const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  if(!key)throw new Error('Local publishable key required.');
  const handle=runLocalFixtureSql(
    "update public.profiles set handle='r6_'||substr(replace(:'actor_id','-',''),1,12),headline='R6 public headline',bio='R6 private biography' where user_id=:'actor_id'::uuid;"+
    "select handle from public.profiles where user_id=:'actor_id'::uuid;",owner.id);
  expect(handle).toMatch(/^r6_[0-9a-f]{12}$/);
  const signed=await fetch(origin+'/auth/v1/token?grant_type=password',{method:'POST',redirect:'error',
    signal:AbortSignal.timeout(15000),headers:{apikey:key,'Content-Type':'application/json'},
    body:JSON.stringify({email:owner.email,password:owner.password})});
  expect(signed.ok).toBe(true);
  const session=await signed.json();
  if(typeof session.access_token!=='string')throw new Error('Local owner token unavailable.');
  async function rpc(name:string,args:Record<string,unknown>){
    const response=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(15000),headers:{apikey:key!,Authorization:'Bearer '+session.access_token,
        'Content-Type':'application/json'},body:JSON.stringify(args)});
    expect(response.ok, name+' should succeed on local stack').toBe(true);
    return await response.json();
  }
  // Deliberate initial publication via real owner JWT and legacy projection
  // contract. No privileged insertion of the publication; not C11 acceptance.
  const initial=await rpc('read_owner_profile_sharing_state',{});
  expect(initial.ownerUserId).toBe(owner.id);
  const selected={shareDisplayName:true,shareHeadline:true,shareBio:false,publicationRequested:true};
  const applied=await rpc('change_owner_profile_sharing',{p_expected_version:initial.version,p_expected:initial.preferences,
    p_desired:selected,p_operation_id:randomUUID()});
  expect(applied.preferences).toEqual(selected);
  const published=await rpc('owner_publish_profile_projection',{p_confirmation:'PUBLISH PROFILE'});
  expect(published.status).toBe('PROJECTION_READY');
  const projection=()=>runLocalFixtureSql(
    "select coalesce(public.service_read_published_profile_projection((select handle from public.profiles where user_id=:'actor_id'::uuid))::text,'ABSENT');",owner.id);
  expect(JSON.parse(projection())).toMatchObject({headline:'R6 public headline',handle});
  expect(projection()).not.toContain('R6 private biography');
  const other=await browser.newPage({baseURL:'http://127.0.0.1:5173'});
  try{
    await signIn(page,owner);await signIn(other,owner);
    for(const tab of [page,other]){
      await tab.goto('/app/profile');
      await tab.getByRole('button',{name:'Saved sharing preferences',exact:true}).click();
      const choices=tab.getByRole('group',{name:'Choose fields for a future publication'});
      await expect(choices.getByRole('checkbox',{name:'Headline',exact:true})).toBeChecked();
      await expect(choices.getByRole('checkbox',{name:'About you',exact:true})).not.toBeChecked();
      await expect(choices.getByRole('button',{name:'Save private sharing choices'})).toBeDisabled();
    }
    const first=page.getByRole('group',{name:'Choose fields for a future publication'});
    const second=other.getByRole('group',{name:'Choose fields for a future publication'});
    // Both pages read the same exact version. First owner explicitly withdraws
    // headline; stale second page tries a different selection.
    await first.getByRole('checkbox',{name:'Headline',exact:true}).uncheck();
    await first.getByRole('checkbox',{name:/I confirm these exact private sharing choices.*withdrawal/}).check();
    await first.getByRole('button',{name:'Save private sharing choices'}).click();
    await expect(page.getByText('Private sharing choices saved and read back. No profile was published.',{exact:true})).toBeVisible({timeout:20000});
    expect(projection()).toBe('ABSENT');
    const afterFirst=await rpc('read_owner_profile_sharing_state',{});
    expect(afterFirst.version).toBe(applied.version+1);
    expect(afterFirst.preferences).toEqual({...selected,shareHeadline:false,publicationRequested:false});
    let stalePosts=0;
    await other.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/change_owner_profile_sharing',async route=>{
      if(route.request().method()==='POST')stalePosts++;
      await route.continue();
    });
    await second.getByRole('checkbox',{name:'About you',exact:true}).check();
    await second.getByRole('checkbox',{name:/I confirm these exact private sharing choices.*withdrawal/}).check();
    await second.getByRole('button',{name:'Save private sharing choices'}).click();
    await expect(other.getByText(/Sharing change could not be confirmed/)).toBeVisible({timeout:30000});
    expect(stalePosts).toBe(1);
    expect(await rpc('read_owner_profile_sharing_state',{})).toEqual(afterFirst);
    await other.getByRole('button',{name:'Retry sharing preferences',exact:true}).click();
    await expect(other.getByText(/The saved sharing choices differ from your attempted change/)).toBeVisible();
    await expect(other.getByRole('button',{name:'Save private sharing choices'})).toBeDisabled();
    expect(stalePosts).toBe(1);
    expect(projection()).toBe('ABSENT');
    await page.reload();
    await page.getByRole('button',{name:'Saved sharing preferences',exact:true}).click();
    const reloaded=page.getByRole('group',{name:'Choose fields for a future publication'});
    await expect(reloaded.getByRole('checkbox',{name:'Headline',exact:true})).not.toBeChecked();
    await expect(reloaded.getByRole('checkbox',{name:'About you',exact:true})).not.toBeChecked();
    await page.getByRole('button',{name:'Profile',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'About you',exact:true})).toHaveValue('R6 private biography');
    expect(await rpc('read_owner_profile_sharing_state',{})).toEqual(afterFirst);
    expect(projection()).toBe('ABSENT');
  }finally{await other.close();}
});

test('B16 C08 profile choice lost acknowledgement and explicit concurrent review preserve the stored CAS',async({page,browser})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(120_000);
  const owner=await localUser('R7 sharing recovery');
  const saved=()=>JSON.parse(runLocalFixtureSql(
    "select coalesce((select jsonb_build_object('display',share_display_name,'headline',share_headline,'bio',share_bio,'requested',publication_requested) from public.profile_sharing_preferences where user_id=:'actor_id'::uuid),'null'::jsonb)::text;",owner.id));
  const second=await browser.newPage();
  try{
    await signIn(page,owner);await signIn(second,owner);
    for(const tab of [page,second]){
      await tab.goto('/app/profile');
      await tab.getByRole('button',{name:'Saved sharing preferences',exact:true}).click();
      const fields=tab.getByRole('group',{name:'Choose fields for a future publication'});
      await expect(fields.getByRole('checkbox',{name:'Headline',exact:true})).not.toBeChecked();
      await expect(fields.getByRole('checkbox',{name:'About you',exact:true})).not.toBeChecked();
    }
    const first=page.getByRole('group',{name:'Choose fields for a future publication'});
    const stale=second.getByRole('group',{name:'Choose fields for a future publication'});
    let writes=0,committed=false;
    await page.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/change_owner_profile_sharing',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      writes++;
      if(writes!==1)return route.continue();
      const real=await route.fetch();
      try{
        expect(real.ok()).toBe(true);
        committed=true;
        await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Disposable lost CAS acknowledgement'})});
      }finally{await real.dispose();}
    });
    await first.getByRole('checkbox',{name:'Headline',exact:true}).check();
    await first.getByRole('checkbox',{name:/I confirm these exact private sharing choices/}).check();
    await first.getByRole('button',{name:'Save private sharing choices'}).click();
    await expect(page.getByText(/Sharing change could not be confirmed/)).toBeVisible({timeout:30000});
    expect(committed).toBe(true);
    expect(saved()).toMatchObject({headline:true,bio:false,requested:false});
    await page.getByRole('button',{name:'Retry sharing preferences',exact:true}).click();
    await expect(page.getByText('Current saved sharing choices match your request. No additional write was made.',{exact:true})).toBeVisible();
    await expect(first.getByRole('checkbox',{name:'Headline',exact:true})).toBeChecked();
    await expect(first.getByRole('button',{name:'Save private sharing choices'})).toBeDisabled();
    expect(writes).toBe(1);
    let staleWrites=0;
    await second.route(url=>url.origin===origin&&url.pathname==='/rest/v1/rpc/change_owner_profile_sharing',async route=>{
      if(route.request().method()==='POST')staleWrites++;
      await route.continue();
    });
    await stale.getByRole('checkbox',{name:'About you',exact:true}).check();
    await stale.getByRole('checkbox',{name:/I confirm these exact private sharing choices/}).check();
    await stale.getByRole('button',{name:'Save private sharing choices'}).click();
    await expect(second.getByText(/Sharing change could not be confirmed/)).toBeVisible({timeout:30000});
    expect(staleWrites).toBe(1);
    await second.getByRole('button',{name:'Retry sharing preferences',exact:true}).click();
    const review=second.getByRole('group',{name:'Review conflicting sharing choices'});
    await expect(review).toBeVisible();
    await expect(stale.getByRole('checkbox',{name:'About you',exact:true})).toBeDisabled();
    await expect(stale.getByRole('checkbox',{name:/I confirm these exact private sharing choices/})).toBeDisabled();
    await review.getByRole('button',{name:'Use saved sharing choices',exact:true}).click();
    await expect(review).toHaveCount(0);
    await expect(stale.getByRole('checkbox',{name:'Headline',exact:true})).toBeChecked();
    await expect(stale.getByRole('checkbox',{name:'About you',exact:true})).not.toBeChecked();
    await expect(stale.getByRole('button',{name:'Save private sharing choices'})).toBeDisabled();
    expect(staleWrites).toBe(1);
    expect(saved()).toMatchObject({headline:true,bio:false,requested:false});
    await page.reload();
    await page.getByRole('button',{name:'Saved sharing preferences',exact:true}).click();
    await expect(page.getByRole('group',{name:'Choose fields for a future publication'}).getByRole('checkbox',{name:'Headline',exact:true})).toBeChecked();
    expect(writes).toBe(1);
  }finally{await second.close();}
});

test('B16 WF-048 R6 actual reviewed nonempty account exit removes only disposable owner data and downloads authoritative receipt',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Destructive test restricted to disposable loopback Supabase.');
  test.setTimeout(125_000);
  const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(process.env.VITE_SUPABASE_URL!==origin||!key)throw new Error('Refusing nonlocal account exit test.');
  const owner=await localUser('R6 disposable erasure owner'),foreign=await localUser('R6 erasure foreign owner');
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQSbn0HwAEJAJK6G06bAAAAABJRU5ErkJggg==','base64');
  const bucket='kadmeion-private-assets';
  const login=async(user:{email:string;password:string})=>fetch(origin+'/auth/v1/token?grant_type=password',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
    headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})
  });
  const upload=async(user:{id:string;email:string;password:string})=>{
    const auth=await login(user);if(!auth.ok)throw new Error('Disposable owner auth failed.');
    const authBody=await auth.json();if(typeof authBody.access_token!=='string')throw new Error('No owner bearer.');
    const headers={apikey:key,Authorization:'Bearer '+authBody.access_token};
    const path=user.id+'/exit/'+randomUUID()+'.png';
    const write=await fetch(origin+'/storage/v1/object/'+bucket+'/'+path,{
      headers:{...headers,'Content-Type':'image/png'},method:'POST',body:bytes,redirect:'error',signal:AbortSignal.timeout(15_000)
    });
    expect(write.ok).toBe(true);await write.body?.cancel();
    const read=()=>fetch(origin+'/storage/v1/object/authenticated/'+bucket+'/'+path,{headers,redirect:'error',signal:AbortSignal.timeout(15_000)});
    const before=await read();expect(before.ok).toBe(true);
    expect(Buffer.from(await before.arrayBuffer()).equals(bytes)).toBe(true);
    return {read};
  };
  // Real owner JWTs, actual private Storage bytes; no admin Storage write.
  const target=await upload(owner),untouched=await upload(foreign);
  await signIn(page,owner);
  await page.goto('/app/settings/account/delete');
  await page.getByRole('button',{name:'Review deletion prerequisites'}).click();
  await expect(page.getByRole('heading',{name:'Private inventory'})).toBeVisible();
  await page.getByRole('textbox',{name:'Type DELETE MY ACCOUNT to record the request'}).fill('DELETE MY ACCOUNT');
  await page.getByRole('button',{name:'Record deletion request'}).click();
  await expect(page.getByText('Deletion request recorded. No data has been erased.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Permanently erase account and prepare receipt'})).toHaveCount(0);
  await page.getByLabel('Current password for identity verification').fill(owner.password);
  await page.getByRole('button',{name:'Verify identity for account exit'}).click();
  await expect(page.getByText(/Fresh sign-in verified\. Proof expires at/)).toBeVisible();
  const section=page.getByRole('region',{name:'Irreversible account erasure'});
  const review=section.getByRole('button',{name:'Review server-gated cleanup readiness'});
  await review.click();
  await expect(section.getByText(/Eligible uploads in the next bounded batch: 1\./)).toBeVisible();
  await expect(section.getByRole('button',{name:'Permanently erase account and prepare receipt'})).toHaveCount(0);
  const remove=section.getByRole('button',{name:'Remove reviewed private uploads'});
  await expect(remove).toBeDisabled();
  await section.getByLabel('Type REMOVE PRIVATE UPLOADS to confirm this batch').fill('REMOVE PRIVATE UPLOADS');
  await remove.click();
  await expect(page.getByText(/Removal of 1 reviewed private uploads was acknowledged/)).toBeVisible();
  expect(runLocalFixtureSql("select count(*) from storage.objects where bucket_id='kadmeion-private-assets' and split_part(name,'/',1)=:'actor_id';",owner.id)).toBe('0');
  const erasedObject=await target.read();expect(erasedObject.ok).toBe(false);await erasedObject.body?.cancel();
  const foreignObject=await untouched.read();expect(foreignObject.ok).toBe(true);expect(Buffer.from(await foreignObject.arrayBuffer()).equals(bytes)).toBe(true);
  await review.click();
  await expect(section.getByText(/Eligible uploads in the next bounded batch: 0\./)).toBeVisible();
  const execute=section.getByRole('button',{name:'Permanently erase account and prepare receipt'});
  await expect(execute).toBeDisabled();
  await section.getByLabel('Type DELETE MY ACCOUNT for final erasure').fill('DELETE MY ACCOUNT');
  const [download]=await Promise.all([page.waitForEvent('download'),execute.click()]);
  expect(download.suggestedFilename()).toBe('kadmeion-account-erasure-receipt.json');
  const file=await download.path();if(!file)throw new Error('Erasure receipt download unavailable.');
  const receipt=JSON.parse(await readFile(file,'utf8'));
  expect(receipt).toMatchObject({status:'ACTIVE_ACCOUNT_ERASED',accessTerminated:false,backupErasureVerified:false,externalCopiesErased:false});
  expect(receipt.receiptId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(runLocalFixtureSql("select (select count(*) from auth.users where id=:'actor_id'::uuid)||':'||(select count(*) from public.profiles where user_id=:'actor_id'::uuid);",owner.id)).toBe('0:0');
  const denied=await login(owner);expect(denied.ok).toBe(false);await denied.body?.cancel();
  const foreignLogin=await login(foreign);expect(foreignLogin.ok).toBe(true);await foreignLogin.body?.cancel();
  expect(runLocalFixtureSql("select count(*) from storage.objects where bucket_id='kadmeion-private-assets' and split_part(name,'/',1)=:'actor_id';",foreign.id)).toBe('1');
});

test('B16 S3/S7 R9 multiple physical private image uploads, repeated slots, canvas decoding and source archive',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Actual disposable local Supabase and mounted editor only.');
  test.setTimeout(150_000);
  if(process.env.VITE_SUPABASE_URL!==origin)throw Error('Refusing nonlocal image test.');
  const owner=await localUser('R9 image owner'),foreign=await localUser('R9 foreign image owner');
  const title='R9 media project',portfolio='R9 media portfolio',altA='R9 private image A',altB='R9 private image B',altRepeat='R9 repeated image A';
  const a=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQSbn0HwAEJAJK6G06bAAAAABJRU5ErkJggg==','base64');
  const b=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpH7DwABpAE8k4sOtwAAAABJRU5ErkJggg==','base64');
  await page.setViewportSize({width:1800,height:1100});
  await signIn(page,owner);await page.goto('/app/projects');
  await page.getByRole('button',{name:'Add first project'}).click();
  const drawer=page.getByRole('dialog',{name:'Add a project'});
  await drawer.getByLabel('Project title').fill(title);
  await drawer.getByRole('button',{name:'Save project'}).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('link',{name:title,exact:true})).toBeVisible();
  await page.getByRole('link',{name:title,exact:true}).click();
  const projectId=new URL(page.url()).pathname.split('/')[3]!;
  expect(projectId).toMatch(/^[a-f0-9-]{36}$/i);
  await page.goto('/app/portfolios/new');
  await page.getByRole('radio',{name:'Collage',exact:true}).check();
  await page.getByLabel('Portfolio name').fill(portfolio);
  await page.getByRole('button',{name:'Choose template and create draft'}).click();
  await expect(page.getByRole('heading',{name:portfolio,level:1})).toBeVisible();
  const editorPath=new URL(page.url()).pathname;
  const manager=page.getByRole('group',{name:'Private asset manager'});
  await page.getByRole('button',{name:'Assets',exact:true}).click();
  // The real project collection must be present before opening the uploader.
  const collection=manager.getByRole('navigation',{name:'Asset collections'});
  await expect(collection.getByRole('button',{name:new RegExp(title)})).toBeVisible();
  const upload=async(bytes:Buffer,alt:string)=>{
    const form=manager.locator('form.ws-asset-upload');
    await expect(form).toBeVisible();
    const project=form.getByRole('combobox');
    await expect(project).toBeEnabled();
    await expect(project.locator('option').filter({hasText:title})).toHaveAttribute('value',projectId);
    await project.selectOption(projectId);
    const file=form.getByLabel('Private image file',{exact:true});
    await expect(file).toBeEnabled();await file.setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:bytes});
    await form.getByLabel('Image alt text').fill(alt);
    const submit=form.getByRole('button',{name:'Upload private image',exact:true});
    await expect(submit).toBeEnabled();await submit.click();
    await expect(manager.getByRole('heading',{name:'Selected image',exact:true})).toBeVisible();
  };
  const place=async(target:string,alt:string)=>{
    const select=manager.locator('label').filter({hasText:'Compatible image slot'}).locator('select');
    // The exact target must exist and be selectable; no fallback to an unrelated slot.
    await expect(select).toBeEnabled();
    await expect(select.locator('option[value="'+target+'"]')).toHaveCount(1);
    await select.selectOption(target);
    await manager.getByLabel('Placement alt text').fill(alt);
    await manager.getByRole('button',{name:/^(Assign image to selected slot|Replace image and stash previous)$/}).click();
    await expect(manager.getByText(/Private image reference applied\. Save draft/)).toBeVisible();
  };
  await manager.getByRole('button',{name:'Open private uploader',exact:true}).click();
  await upload(a,altA);await place('collage-hero-imagea',altA);
  await manager.getByRole('button',{name:'Register another image',exact:true}).click();
  await upload(b,altB);await place('collage-hero-imageb',altB);
  await manager.getByRole('button',{name:new RegExp(altA)}).click();
  await place('project-showcase-image',altRepeat);
  await manager.getByRole('button',{name:'Back to editor canvas',exact:true}).click();
  const canvas=page.getByRole('region',{name:'Private authoring canvas'});
  const check=async()=>{
    const previews=canvas.getByRole('group',{name:'Private canvas image previews'});
    const show=previews.getByRole('button',{name:'Show private canvas images'});
    if(await show.isVisible())await show.click();
    await expect(previews.getByRole('status')).toContainText('3 of 3 owner-private image slots verified');
    const urls:string[]=[];
    for(const [alt,bytes] of [[altA,a],[altB,b],[altRepeat,a]] as const){
      const img=canvas.getByRole('img',{name:alt,exact:true});
      await expect(img).toBeVisible();
      await expect.poll(()=>img.evaluate(async(node,expected)=>{
        const image=node as HTMLImageElement;
        if(!image.complete||image.naturalWidth!==1||image.naturalHeight!==1||!image.src.startsWith('blob:'))return false;
        const result=await fetch(image.src),actual=new Uint8Array(await result.arrayBuffer());
        return result.ok&&actual.length===expected.length&&actual.every((v,i)=>v===expected[i]);
      },Array.from(bytes))).toBe(true);
      urls.push((await img.getAttribute('src'))!);
    }
    expect(urls[0]).toBe(urls[2]);expect(urls[0]).not.toBe(urls[1]);
    return urls;
  };
  await check();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByText('Private portfolio draft saved.',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:portfolio,level:1})).toBeVisible();
  const urls=await check();
  await canvas.getByRole('button',{name:'Hide private canvas images'}).click();
  await expect(canvas.getByRole('img',{name:altA,exact:true})).toHaveCount(0);
  for(const url of new Set(urls))expect(await page.evaluate(async value=>{try{await fetch(value);return false;}catch{return true;}},url)).toBe(true);
  await check();
  await page.goto('/app/export');
  await page.getByLabel('Portfolio to export').selectOption(editorPath.split('/')[3]!);
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:30000}),page.getByRole('button',{name:'Download portfolio source ZIP'}).click()]);
  const file=await download.path();if(!file)throw Error('Source ZIP absent.');
  const snapshot=importPortfolioSourceZip(new Uint8Array(await readFile(file)));
  const x=snapshot.slots['collage-hero-imagea'],y=snapshot.slots['collage-hero-imageb'],z=snapshot.slots['project-showcase-image'];
  expect(x).toMatchObject({state:'S0',componentId:'image@1',content:{alt_text:altA}});
  expect(y).toMatchObject({state:'S0',componentId:'image@1',content:{alt_text:altB}});
  expect(z).toMatchObject({state:'S0',componentId:'image@1',content:{alt_text:altRepeat}});
  expect(x.content.asset_id).toMatch(/^[a-f0-9-]{36}$/i);expect(y.content.asset_id).toMatch(/^[a-f0-9-]{36}$/i);
  expect(x.content.asset_id).toBe(z.content.asset_id);expect(x.content.asset_id).not.toBe(y.content.asset_id);
  for(const slot of [x,y,z])expect(slot.content.source_sha256).toBeUndefined();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page).toHaveURL(/\/signin$/);await signIn(page,foreign);
  await page.goto(editorPath);await expect(page.getByRole('alert')).toBeVisible();
  await expect(canvas).toHaveCount(0);await expect(page.getByRole('img',{name:altA,exact:true})).toHaveCount(0);
});
