import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test, expect} from '@playwright/test';
import { auditAccessibility } from './accessibility.ts';
import {readStrictStoredZip} from '../../../packages/storage-adapters/src/portable-source-archive.ts';

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
      if(width===320) await auditAccessibility(page,screenshot+'_DARK_320',capture);
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
      if(width===1600) await auditAccessibility(page,screenshot+'_LIGHT_1600',capture);
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
  await page.goto('/app/export');
  const recoveryDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download private recovery ZIP'}).click();
  expect((await recoveryDownload).suggestedFilename()).toBe('kadmeion-private-account-partial.zip');
  await expect(page.getByText('Private recovery download prepared.')).toBeVisible();
  await page.goto('/app/settings/account/delete');
  await page.getByRole('button',{name:'Review deletion prerequisites'}).click();
  await expect(page.getByRole('heading',{name:'Private inventory'})).toBeVisible();
  const request=page.getByRole('button',{name:'Record deletion request'});
  await expect(request).toBeDisabled();
  await page.getByRole('textbox',{name:'Type DELETE MY ACCOUNT to record the request'}).fill('DELETE MY ACCOUNT');
  await request.click();
  await expect(page.getByText('Deletion request recorded. No data has been erased.')).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'Review deletion prerequisites'}).click();
  const identity=page.getByRole('button',{name:'Verify identity for account exit'});
  const password=page.getByLabel('Current password for identity verification');
  await password.fill('Wrong fixture password');
  await identity.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(password).toHaveValue('');
  await password.fill(owner.password);
  await identity.click();
  await expect(page.getByText('Fresh sign-in verified.',{exact:false})).toBeVisible();
  const appWithdrawal=page.getByRole('button',{name:'Withdraw app-managed public content'});
  await expect(appWithdrawal).toBeDisabled();
  await page.getByRole('textbox',{name:'Type WITHDRAW PUBLIC CONTENT to confirm'}).fill('WITHDRAW PUBLIC CONTENT');
  await appWithdrawal.click();
  await expect(page.getByText('Application withdrawal confirmed.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Withdraw deletion request'}).click();
  await expect(page.getByText('Account deletion request withdrawn.')).toBeVisible();
  await expect(page.getByRole('list',{name:'Recent deletion requests'})).toContainText('Withdrawn');
  await expect(page.getByRole('button',{name:/Delete account/i})).toHaveCount(0);
});

test('B16 WF-047 actual private export downloads, receipt hashes and inventory retry/reuse',async({page})=>{
  test.skip(process.env.KADMEION_LOCAL_BROWSER!=='1','Disposable local Supabase only.');
  test.setTimeout(120_000);
  const owner=await createLocalOwner();
  await page.goto('/signin');
  await page.getByRole('textbox',{name:'Email address'}).fill(owner.email);
  await page.locator('#signin-password').fill(owner.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified'})).toBeVisible();

  let downloads=0;
  page.on('download',()=>downloads++);
  const captureOperations:string[]=[];
  let rejectFirst=true;
  await page.route('**/rest/v1/rpc/create_private_account_exit_inventory',async route=>{
    const body=route.request().postDataJSON() as {p_operation_id:string};
    captureOperations.push(body.p_operation_id);
    if(rejectFirst){rejectFirst=false;await route.fulfill({status:429,json:{message:'Disposable fixture rate limit'}});}
    else await route.continue();
  });
  await page.goto('/app/export');
  await expect(page.getByRole('heading',{name:'Export center',level:1})).toBeVisible();
  await page.getByRole('button',{name:'Download application metadata'}).click();
  await expect(page.getByRole('alert')).toContainText('temporarily rate-limited the export');
  expect(downloads).toBe(0);
  expect(captureOperations.length).toBe(1);
  const readDownload=async(buttonName:string,filename:string,notice:string)=>{
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:buttonName,exact:true}).click()]);
    expect(download.suggestedFilename()).toBe(filename);
    const path=await download.path();
    if(!path)throw new Error('Disposable browser download did not yield a file.');
    const bytes=await readFile(path);
    await expect(page.getByText(notice,{exact:true})).toBeVisible();
    const receipt=page.locator('section.ws-setting-card').filter({has:page.getByRole('heading',{name:'Latest download receipt',exact:true})});
    await expect(receipt.getByText(filename,{exact:true})).toBeVisible();
    await expect(receipt.locator('code')).toHaveText(createHash('sha256').update(bytes).digest('hex'));
    return bytes;
  };
  const metadataBytes=await readDownload('Retry failed export','kadmeion-account-metadata.json','Application metadata download prepared.');
  expect(captureOperations.length).toBe(2);
  expect(/^[0-9a-f-]{36}$/.test(captureOperations[0]!)&&captureOperations[0]===captureOperations[1]).toBe(true);
  const metadata=JSON.parse(metadataBytes.toString('utf8')) as Record<string,unknown>;
  expect(metadata.status==='APPLICATION_METADATA_SNAPSHOT'&&metadata.schemaVersion===1&&
    metadata.storageBytesIncluded===false&&metadata.providerDataIncluded===false&&metadata.deletionAllowed===false&&
    typeof metadata.snapshotId==='string'&&typeof metadata.ownerUserId==='string').toBe(true);
  const jsonBytes=await readDownload('Download verified recovery JSON','kadmeion-private-account-partial-export.json','Verified recovery JSON download prepared.');
  const recovery=JSON.parse(jsonBytes.toString('utf8')) as {
    kind:string;schemaVersion:number;inventorySnapshotId:string;owner:{id:string};limitations:{completeAccountExport:boolean;deletionAllowed:boolean}
  };
  expect(recovery.kind==='kadmeion-bounded-private-account-export'&&recovery.schemaVersion===1&&
    recovery.inventorySnapshotId===metadata.snapshotId&&recovery.owner.id===metadata.ownerUserId&&
    recovery.limitations.completeAccountExport===false&&recovery.limitations.deletionAllowed===false).toBe(true);
  const zipBytes=await readDownload('Download private recovery ZIP','kadmeion-private-account-partial.zip','Private recovery download prepared.');
  const entries=readStrictStoredZip(new Uint8Array(zipBytes),{maxEntries:12,maxBytes:10*1024*1024,maxEntryBytes:5*1024*1024});
  expect([...entries.keys()].sort()).toEqual(['README.txt','account/records.json','kadmeion-partial-bundle.json']);
  const manifest=JSON.parse(new TextDecoder().decode(entries.get('kadmeion-partial-bundle.json')!)) as {
    ownerId:string;inventorySnapshotId:string;privateData:boolean;completeAccountExport:boolean;deletionAllowed:boolean;recordsSha256:string
  };
  expect(manifest.ownerId===metadata.ownerUserId&&manifest.inventorySnapshotId===metadata.snapshotId&&
    manifest.privateData===true&&manifest.completeAccountExport===false&&manifest.deletionAllowed===false&&
    manifest.recordsSha256===createHash('sha256').update(entries.get('account/records.json')!).digest('hex')).toBe(true);
  expect(downloads).toBe(3);
  // All successful formats reused the one real acknowledged inventory.
  expect(captureOperations.length).toBe(2);
  // No private artifact bytes or owner identifiers are emitted to logs.
});
