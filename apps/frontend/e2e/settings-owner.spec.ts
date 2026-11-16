import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {test, expect} from '@playwright/test';

const localApi='http://127.0.0.1:54321';

/** Disposable CI owner only. No hosted user or Supabase project may be mutated. */
async function createLocalOwner(){
  if(process.env.KADMEION_LOCAL_BROWSER!=='1'||
     process.env.VITE_SUPABASE_URL!==localApi||
     !process.env.KADMEION_TEST_SERVICE_ROLE_KEY)
    throw new Error('F5 owner acceptance requires the isolated local Supabase fixture.');
  const password='Fixture!'+randomUUID();
  const email='f5-'+randomUUID()+'@testing.invalid';
  const key=process.env.KADMEION_TEST_SERVICE_ROLE_KEY;
  const res=await fetch(localApi+'/auth/v1/admin/users',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({email,password,email_confirm:true,
      user_metadata:{display_name:'F5 Private Fixture'}})
  });
  if(!res.ok)throw new Error('F5 local owner fixture failed: HTTP '+res.status);
  return {email,password};
}

test('F5 owner settings 41-47 reflow in real light/dark authenticated workspace',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Needs ephemeral local Supabase and owner JWT.');
  test.setTimeout(130_000);
  const owner=await createLocalOwner();
  await page.goto('/signin');
  await page.getByRole('textbox',{name:'Email address'}).fill(owner.email);
  await page.locator('#signin-password').fill(owner.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified'})).toBeVisible();

  await page.goto('/app/settings');
  await expect(page.getByRole('heading',{name:'Settings',level:1})).toBeVisible();
  for(const category of ['Your account','Control & privacy','Your data','Visibility'])
    await expect(page.getByRole('heading',{name:category,level:2})).toBeVisible();
  await expect(page.getByRole('link',{name:'Open privacy & sharing'}))
    .toHaveAttribute('href','/app/settings/privacy');
  await expect(page.getByRole('link',{name:'Open export center'}))
    .toHaveAttribute('href','/app/export');
  const hub=await page.locator('.ws-settings-hub').boundingBox();
  expect(hub).not.toBeNull();
  expect(hub!.y+hub!.height,'All four settings groups should fit within the 1600x900 desktop workspace')
    .toBeLessThanOrEqual(901);
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');

  const screens=[
    ['/app/settings','Settings','41_SETTINGS'],
    ['/app/settings/privacy','Privacy & sharing','42_PRIVACY'],
    ['/app/notifications','Notifications','43_NOTIFICATIONS'],
    ['/app/settings/security','Account security','44_SECURITY'],
    ['/app/trash','Trash','45_TRASH'],
    ['/app/export','Export center','46_EXPORT'],
    ['/app/settings/account/delete','Account exit','47_ACCOUNT_EXIT']
  ] as const;
  const capture=process.env.KADMEION_BROWSER_CAPTURE_DIR;
  // A visible route shell is not a ready screenshot. Wait for confirmed
  // owner-service data, not just a heading or an ephemeral loading placeholder.
  async function waitForSettingsContent(route:string){
    switch(route){
      case '/app/settings':
        await expect(page.getByRole('heading',{name:'Your account',level:2})).toBeVisible();
        break;
      case '/app/settings/privacy':
        await expect(page.getByRole('button',{name:'Save sharing preferences'})).toBeVisible();
        await expect(page.getByText('Loading sharing preferences…')).toHaveCount(0);
        await expect(page.getByRole('heading',{name:'Privacy boundaries'})).toBeVisible();
        await expect(page.getByRole('link',{name:'Review private portfolios'}))
          .toHaveAttribute('href','/app/portfolios');
        break;
      case '/app/notifications':
        await expect(page.getByRole('heading',{name:'Inbox'})).toBeVisible();
        await expect(page.getByText('Loading notifications…')).toHaveCount(0);
        await expect(page.getByRole('group',{name:'Filter loaded notifications'})).toBeVisible();
        break;
      case '/app/settings/security':
        await expect(page.getByRole('button',{name:'Sign out other sessions'})).toBeVisible();
        await expect(page.getByRole('heading',{name:'Security confirmations'})).toBeVisible();
        break;
      case '/app/trash':
        await expect(page.getByText('Trash is empty.')).toBeVisible();
        break;
      case '/app/export':
        await expect(page.getByRole('button',{name:'Download application metadata'})).toBeVisible();
        break;
      case '/app/settings/account/delete':
        await page.getByRole('button',{name:'Review deletion prerequisites'}).click();
        await expect(page.getByRole('heading',{name:'Private inventory'})).toBeVisible();
        break;
    }
  }

  for(const width of [1600,390,320]){
    await page.setViewportSize({width,height:900});
    for(const [route,heading,screenshot] of screens){
      await page.goto(route);
      await expect(page.getByRole('heading',{name:heading,level:1})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
      await expect(page.locator('.ws-settings-body')).toBeVisible();
      await waitForSettingsContent(route);
      const dimensions=await page.evaluate(()=>({
        visible:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth
      }));
      expect(dimensions.scroll,route+' overflow at '+width+'px')
        .toBeLessThanOrEqual(dimensions.visible+2);
      if(capture&&width!==320){
        await mkdir(capture,{recursive:true});
        await page.screenshot({path:capture+'/'+screenshot+'_DARK_'+width+'.png',
          animations:'disabled'});
      }
    }
  }

  // Approved references are LIGHT; produce current-source captures rather
  // than treating a dark-mode functional pass as visual acceptance.
  await page.setViewportSize({width:1600,height:900});
  await page.goto('/app/settings');
  await page.getByRole('button',{name:'Switch to light theme'}).click();
  for(const width of [1600,390]){
    await page.setViewportSize({width,height:900});
    for(const [route,heading,screenshot] of screens){
      await page.goto(route);
      await expect(page.getByRole('heading',{name:heading,level:1})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme','light');
      await waitForSettingsContent(route);
      const dimensions=await page.evaluate(()=>({
        viewport:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth
      }));
      expect(dimensions.scroll,route+' light overflow at '+width+'px')
        .toBeLessThanOrEqual(dimensions.viewport+2);
      if(capture){
        await mkdir(capture,{recursive:true});
        await page.screenshot({path:capture+'/'+screenshot+'_LIGHT_'+width+'.png',
          animations:'disabled'});
      }
    }
  }
  await page.setViewportSize({width:1366,height:900});
  await page.goto('/app/settings/security');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'Show password entries'}).click();
  await expect(page.getByLabel('Current password')).toHaveAttribute('type','text');
  await expect(page.getByLabel('New password',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Hide password entries'}).click();
  await expect(page.getByLabel('Current password')).toHaveAttribute('type','password');
  await expect(page.getByLabel('Current password')).toBeVisible();
  await expect(page.getByLabel('New password',{exact:true})).toBeVisible();
  const revokeTrigger=page.getByRole('button',{name:'Sign out other sessions'});
  await revokeTrigger.click();
  await expect(page.getByRole('group',{name:'Confirm other-session sign-out'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group',{name:'Confirm other-session sign-out'})).toHaveCount(0);
  await expect(revokeTrigger).toBeFocused();
  await revokeTrigger.click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(revokeTrigger).toBeFocused();
  await page.goto('/app/notifications');
  const notificationFilters=page.getByRole('group',{name:'Filter loaded notifications'});
  await expect(notificationFilters).toBeVisible();
  await notificationFilters.getByRole('button',{name:'Unread'}).click();
  await expect(notificationFilters.getByRole('button',{name:'Unread'})).toHaveAttribute('aria-pressed','true');
  await notificationFilters.getByRole('button',{name:'All loaded'}).click();
  await expect(notificationFilters.getByRole('button',{name:'All loaded'})).toHaveAttribute('aria-pressed','true');
  // A missing preference row must reflect effective PostgreSQL defaults:
  // reviewer/publishing notices on, draft-sync notices off. Then persist a
  // real change under the disposable owner JWT and read it back after reload.
  await expect(page.getByText(/No saved preference record was returned/)).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'Reviewer activity'})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Publishing activity'})).toBeChecked();
  const syncPreference=page.getByRole('checkbox',{name:'Draft sync activity'});
  await expect(syncPreference).not.toBeChecked();
  const preferencesRpc='**/rest/v1/rpc/owner_set_notification_preferences';
  const rejectedWrite=Promise.withResolvers<void>();
  await page.route(preferencesRpc,async route=>{
    await rejectedWrite.promise;
    await route.fulfill({status:503,json:{message:'Fixture preference outage'}});
  },{times:1});
  try {
    await syncPreference.focus();
    await syncPreference.press('Space');
    await expect(syncPreference).toBeChecked();
    await expect(syncPreference).toBeFocused();
    await expect(syncPreference).toBeDisabled();
    await expect(page.getByText('Saving notification preferences…')).toBeVisible();
    await expect(page.getByText('Notification preferences saved.')).toHaveCount(0);
  } finally {
    rejectedWrite.resolve();
  }
  await expect(page.getByRole('alert')).toContainText('Could not confirm the change.');
  await expect(syncPreference).not.toBeChecked();
  await expect(syncPreference).toBeFocused();
  await syncPreference.press('Space');
  await expect(page.getByText('Notification preferences saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox',{name:'Reviewer activity'})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Publishing activity'})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Draft sync activity'})).toBeChecked();
  await page.goto('/app/settings/privacy');
  await expect(page.getByRole('button',{name:'Save sharing preferences'})).toBeDisabled();
  await page.goto('/app/settings/account/delete');
  await expect(page.getByRole('button',{name:'Review deletion prerequisites'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Delete account/i})).toHaveCount(0);
});
