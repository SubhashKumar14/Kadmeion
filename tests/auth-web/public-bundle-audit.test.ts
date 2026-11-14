import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditPublicBundle} from '../../scripts/audit-public-bundle.mjs';

async function directory(run:(root:string)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'kadmeion-bundle-audit-'));
  try{await run(root);}finally{await rm(root,{recursive:true,force:true});}
}
test('public bundle scanner accepts only bounded browser-safe example keys',async()=>{
  await directory(async root=>{
    await mkdir(join(root,'compiled'),{recursive:true});
    await writeFile(join(root,'index.html'),'<title>Kadmeion</title>');
    await writeFile(join(root,'compiled','config.js'),
      'const publishable="sb_publishable_ci_test_only";');
    const value=await auditPublicBundle(root);
    assert.equal(value.status,'PUBLIC_ARTIFACT_SCANNED');
    assert.equal(value.filesChecked,2);
    assert.ok(value.bytesChecked>0);
    assert.equal(value.serverSecretMarkerFound,false);
  });
});
test('public scanner rejects all known server-secret markers without echoing values',async()=>{
  for(const value of [
    'sb_secret_privateexample0123456789',
    'process.env.SUPABASE_SERVICE_ROLE_KEY',
    'KADMEION_TRASH_SWEEP_SECRET',
    'DATABASE_URL=postgresql://postgres:password@database.invalid/mydb',
    '-----BEGIN PRIVATE KEY-----'
  ]){
    await directory(async root=>{
      await writeFile(join(root,'index.html'),value);
      await assert.rejects(auditPublicBundle(root),error=>{
        assert.equal(error.code,'PRIVATE_SECRET_MARKER');
        assert.ok(!error.message.includes(value));
        return true;
      });
    });
  }
});
test('public scanner refuses symlinks even if their target is browser-safe',async()=>{
  await directory(async root=>{
    const target=join(root,'index.html');
    await writeFile(target,'Safe');
    await symlink(target,join(root,'linked.js'));
    await assert.rejects(auditPublicBundle(root),{code:'SYMLINK'});
  });
});
test('public scanner fails closed on oversize or empty distribution',async()=>{
  await directory(async root=>{
    await assert.rejects(auditPublicBundle(root),{code:'EMPTY'});
    await writeFile(join(root,'index.html'),'a'.repeat(4*1024*1024+1));
    await assert.rejects(auditPublicBundle(root),{code:'FILE_SIZE'});
  });
});
