import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {zipSync,unzipSync} from 'fflate';
import {emptyGarment,initialProfile} from '../lib/model';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://backup-test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',photo='33333333-3333-4333-8333-333333333333';
const bytes=await readFile(new URL('./fixtures/sample.jpg',import.meta.url));
const files=new Map<string,Uint8Array>([[`${user}/${photo}.jpg`,bytes]]);
const archive={format:'my-style-archive',version:1,exported_at:new Date().toISOString(),profile:initialProfile,categories:['我的分类'],counters:[{prefix:'P',last_value:5}],garments:[{id:'11111111-1111-4111-8111-111111111111',code:'P001',data:{...emptyGarment,name:'备份测试'},version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),photos:[{id:photo,path:`${user}/${photo}.jpg`,size:bytes.length,width:700,height:900,position:0}]}]};
let uploads=0,restores=0,failCommit=false;
const fetchOriginal=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init);const url=new URL(request.url);const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
 if(url.pathname.endsWith('/rpc/export_archive'))return json(archive);
 if(url.pathname.endsWith('/rpc/restore_archive')){restores++;return failCommit?json({message:'编号冲突'},400):json(1);}
 if(url.pathname.includes('/object/')){
  const key=url.pathname.split('/wardrobe/')[1];
  if(request.method==='GET'){const b=files.get(key);return b?new Response(new Uint8Array(b).buffer,{headers:{'content-type':'image/jpeg'}}):json({message:'Missing'},404);}
  if(request.method==='POST'){uploads++;if(files.has(key))return json({message:'Already exists'},409);const f=(await request.formData()).get('') as File;files.set(key,new Uint8Array(await f.arrayBuffer()));return json({Key:key});}
 }
 return json({message:'Unexpected test endpoint'},500);
};
const {createBackup,readBackup,restoreBackup}=await import('../lib/backup');
test('ZIP 中保留照片、JSON、CSV；可校验并恢复完整内容',async()=>{
 try{
  const blob=await createBackup(()=>{});const restored=await readBackup(new File([blob],'archive.zip',{type:'application/zip'}));
  assert.equal(restored.archive.garments[0].code,'P001');assert.equal(restored.archive.counters[0].last_value,5);assert.ok(restored.files['garments.csv']);assert.deepEqual(restored.files[`photos/${photo}.jpg`],new Uint8Array(bytes));
  files.clear();assert.equal(await restoreBackup(restored,user,()=>{}),1);assert.equal(files.size,1);
  assert.equal(await restoreBackup(restored,user,()=>{}),1);assert.equal(files.size,1);assert.equal(restores,2);
 }finally{ /* 全部测试结束后恢复 fetch。 */ }
});
test('缺图或损坏 ZIP 在上传之前拒绝',async()=>{
 const blob=await createBackup(()=>{});const entries=unzipSync(new Uint8Array(await blob.arrayBuffer()));const before=uploads;delete entries[`photos/${photo}.jpg`];
 await assert.rejects(readBackup(new File([new Uint8Array(zipSync(entries)).buffer],'missing.zip')),/缺少照片/);assert.equal(uploads,before);
 const clean=unzipSync(new Uint8Array(await blob.arrayBuffer()));clean[`photos/${photo}.jpg`][100]^=1;
 await assert.rejects(readBackup(new File([new Uint8Array(zipSync(clean)).buffer],'corrupt.zip')),/校验失败/);
});
test('提交失败可重复恢复；同名不同照片拒绝覆盖',async()=>{
 const blob=await createBackup(()=>{});const backup=await readBackup(new File([blob],'archive.zip'));failCommit=true;
 await assert.rejects(restoreBackup(backup,user,()=>{}),(e:unknown)=>typeof e==='object' && e!==null && 'message' in e && e.message==='编号冲突');failCommit=false;assert.equal(await restoreBackup(backup,user,()=>{}),1);
 files.set(`${user}/${photo}.jpg`,new Uint8Array([1,2,3]));await assert.rejects(restoreBackup(backup,user,()=>{}),/冲突/);globalThis.fetch=fetchOriginal;
});
