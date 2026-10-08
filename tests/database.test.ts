import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { emptyGarment, initialProfile } from "../lib/model";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id1 = "11111111-1111-4111-8111-111111111111",
  id2 = "22222222-2222-4222-8222-222222222222";
const photo1 = "33333333-3333-4333-8333-333333333333",
  photo2 = "44444444-4444-4444-8444-444444444444";
test("真实 PostgreSQL：RLS、照片关联、编号、编辑冲突、完整恢复与回滚", async (t) => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);insert into auth.users values('${userA}'),('${userB}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated;
 grant select,insert,delete on storage.objects to authenticated;grant execute on function auth.uid() to anon,authenticated;
 `);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/001_archive.sql", import.meta.url),
      "utf8",
    ),
  );
  async function asUser(user: string, role = "authenticated") {
    await db.exec(
      `reset role;set role ${role};set request.jwt.claim.sub='${user}'`,
    );
  }
  const data = { ...emptyGarment, name: "测试裤子" };
  const photos = [photo1, photo2].map((id, i) => ({
    id,
    path: `${userA}/${id}.jpg`,
    size: 100,
    width: 800,
    height: 1000,
    position: i,
  }));
  await asUser(userA);
  await t.test("一张/多张照片由私有路径关联，编号 P001", async () => {
    for (const p of photos)
      await db.query(
        "insert into storage.objects(bucket_id,name) values($1,$2)",
        ["wardrobe", p.path],
      );
    await db.query("select public.save_garment($1,$2,$3,0)", [
      id1,
      data,
      [photos[0]],
    ]);
    await db.query("select public.save_garment($1,$2,$3,1)", [
      id1,
      data,
      photos,
    ]);
    assert.equal(
      (await db.query<{ code: string }>("select code from public.garments"))
        .rows[0].code,
      "P001",
    );
    assert.equal(
      (await db.query("select * from public.photos")).rows.length,
      2,
    );
  });
  await t.test("编辑后编号不变；过期版本不覆盖新修改", async () => {
    await db.query("select public.save_garment($1,$2,$3,2)", [
      id1,
      { ...data, category: "上衣", color: "蓝色" },
      photos,
    ]);
    await assert.rejects(
      db.query("select public.save_garment($1,$2,$3,1)", [id1, data, photos]),
      /其他设备/,
    );
    assert.equal(
      (await db.query<{ code: string }>("select code from public.garments"))
        .rows[0].code,
      "P001",
    );
  });
  await t.test("用户B无法读取、修改用户A的衣服或读取照片路径", async () => {
    await asUser(userB);
    assert.equal(
      (await db.query("select * from public.garments")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.photos")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select public.save_garment($1,$2,$3,3)", [id1, data, photos]),
      /无权/,
    );
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
        "wardrobe",
        photos[0].path,
      ]),
      /row-level security/,
    );
  });
  await t.test("匿名无法调用保存、读取衣服或导出", async () => {
    await asUser("", "anon");
    await assert.rejects(
      db.query("select * from public.garments"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.export_archive()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.save_garment($1,$2,$3,0)", [id2, data, []]),
      /permission denied/,
    );
  });
  await asUser(userA);
  await t.test("归档保留记录、缺照片事务回滚、相邻编号不复用", async () => {
    await db.query("select public.save_garment($1,$2,$3,3)", [
      id1,
      { ...data, archived: true },
      photos,
    ]);
    await assert.rejects(
      db.query("select public.save_garment($1,$2,$3,0)", [
        id2,
        data,
        [{ ...photos[0], id: id2, path: `${userA}/${id2}.jpg` }],
      ]),
      /照片缺失/,
    );
    await db.query("select public.save_garment($1,$2,$3,0)", [id2, data, []]);
    assert.equal(
      (
        await db.query<{ code: string }>(
          "select code from public.garments where id=$1",
          [id2],
        )
      ).rows[0].code,
      "P002",
    );
    await db.query("select public.delete_garments($1)", [[id2]]);
  });
  await t.test("风格保存与乐观锁", async () => {
    await db.query("select public.save_profile($1,0)", [initialProfile]);
    await assert.rejects(
      db.query("select public.save_profile($1,0)", [initialProfile]),
      /已更新/,
    );
  });
  const archive = (
    await db.query<{ export_archive: any }>("select public.export_archive()")
  ).rows[0].export_archive;
  await t.test("重复导入安全跳过、资料冲突整体回滚", async () => {
    assert.equal(
      (
        await db.query<{ restore_archive: number }>(
          "select public.restore_archive($1)",
          [archive],
        )
      ).rows[0].restore_archive,
      0,
    );
    const changed = structuredClone(archive);
    changed.garments[0].data.name = "冲突";
    await assert.rejects(
      db.query("select public.restore_archive($1)", [changed]),
      /记录冲突/,
    );
  });
  await t.test(
    "删除后恢复照片关系和编号，计数器保留已删除的 P002",
    async () => {
      await db.query("select public.delete_garments($1)", [[id1]]);
      assert.equal(
        (await db.query("select * from public.photos")).rows.length,
        0,
      );
      await db.query("select public.restore_archive($1)", [archive]);
      assert.equal(
        (await db.query("select * from public.photos")).rows.length,
        2,
      );
      await db.query("select public.save_garment($1,$2,$3,0)", [id2, data, []]);
      assert.equal(
        (
          await db.query<{ code: string }>(
            "select code from public.garments where id=$1",
            [id2],
          )
        ).rows[0].code,
        "P003",
      );
    },
  );
  await t.test("已关联文件不能被删除，未关联残留可以删除", async () => {
    await db.query("delete from storage.objects where name=$1", [
      photos[0].path,
    ]);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      2,
    );
    const path = `${userA}/${id2}.jpg`;
    await db.query(
      "insert into storage.objects(bucket_id,name) values($1,$2)",
      ["wardrobe", path],
    );
    await db.query("delete from storage.objects where name=$1", [path]);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      2,
    );
  });
  await db.close();
});
