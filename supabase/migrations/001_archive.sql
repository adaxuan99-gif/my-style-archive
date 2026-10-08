-- 仅用于全新 Supabase 项目。请先阅读 docs/部署与使用.md。
begin;
create table public.number_counters (
 user_id uuid not null references auth.users(id) on delete cascade,
 prefix text not null, last_value bigint not null check(last_value>0), primary key(user_id,prefix)
);
create table public.garments (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 code text not null check(code ~ '^[A-Z]{1,3}[0-9]{3,10}$'), data jsonb not null,
 version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,code), unique(id,user_id),
 constraint garment_shape check (
 jsonb_typeof(data)='object' and length(data->>'name') between 1 and 100
 and length(data->>'category') between 1 and 50
 and jsonb_typeof(data->'tags')='array' and jsonb_typeof(data->'seasons')='array'
 and jsonb_typeof(data->'archived')='boolean'
 and data->>'status' in ('经常穿','偶尔穿','喜欢但不会搭','很少穿','准备出售','准备淘汰','已出售或已淘汰')
 and (data->>'rating')::integer between 1 and 5
 and octet_length(data::text)<30000
 and data ?& array['name','category','tags','seasons','archived','status','rating']
 )
);
create index garments_owner_updated on public.garments(user_id,updated_at desc);
create index garments_category on public.garments(user_id,(data->>'category'));
create table public.photos (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 garment_id uuid not null, path text not null unique,
 size integer not null check(size between 1 and 2097152),
 width integer not null check(width between 1 and 1600), height integer not null check(height between 1 and 1600),
 position integer not null check(position between 0 and 11),
 foreign key(garment_id,user_id) references public.garments(id,user_id) on delete cascade,
 check(path=user_id::text || '/' || id::text || '.jpg'),
 unique(garment_id,position)
);
create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<50000),
 version integer not null default 1, updated_at timestamptz not null default now()
);
create table public.categories (
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 50), primary key(user_id,name)
);
-- 私人数据：包括计数器在内的所有表启用 RLS。
alter table public.garments enable row level security;
alter table public.photos enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.number_counters enable row level security;
create policy own_garments on public.garments for select to authenticated using(user_id=(select auth.uid()));
create policy own_photos on public.photos for select to authenticated using(user_id=(select auth.uid()));
create policy own_profiles on public.profiles for select to authenticated using(user_id=(select auth.uid()));
create policy own_categories on public.categories for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.garments,public.photos,public.profiles,public.categories,public.number_counters from anon,authenticated;
grant select on public.garments,public.photos,public.profiles to authenticated;
grant select,insert,delete on public.categories to authenticated;

-- 私有桶；原始文件不直接上传，仅接受压缩后的 JPEG，单图最高 2MB。
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('wardrobe','wardrobe',false,2097152,array['image/jpeg']);
create policy wardrobe_read on storage.objects for select to authenticated
 using(bucket_id='wardrobe' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy wardrobe_insert on storage.objects for insert to authenticated
 with check(bucket_id='wardrobe' and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.jpg$'));
-- 不允许覆盖已存在照片，替换时创建新文件；关联中的照片不能提前删除。
create policy wardrobe_delete on storage.objects for delete to authenticated
 using(bucket_id='wardrobe' and (storage.foldername(name))[1]=(select auth.uid())::text
 and not exists(select 1 from public.photos p where p.path=name));

create function public.save_garment(p_id uuid,p_data jsonb,p_photos jsonb,p_version integer default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); old public.garments; pref text; seq bigint; ph jsonb;
begin
 if u is null then raise exception '请先登录'; end if;
 if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos)>12 then raise exception '照片数量必须为 0–12'; end if;
 select * into old from public.garments where id=p_id for update;
 if found then
   if old.user_id<>u then raise exception '无权操作'; end if;
   if old.version<>p_version then raise exception '资料已在其他设备修改，请刷新后重试'; end if;
   update public.garments set data=p_data,version=version+1,updated_at=now() where id=p_id;
 else
   if p_version<>0 then raise exception '衣服不存在，请刷新'; end if;
   pref:=case p_data->>'category' when '裤子' then 'P' when '上衣' then 'T' when '鞋子' then 'S' when '外套' then 'O' when '裙子' then 'K' when '连衣裙' then 'D' when '包包' then 'B' when '帽子' then 'H' when '首饰' then 'J' when '其他配饰' then 'A' else 'X' end;
   insert into public.number_counters values(u,pref,1) on conflict(user_id,prefix) do update set last_value=public.number_counters.last_value+1 returning last_value into seq;
   insert into public.garments(id,user_id,code,data) values(p_id,u,pref||case when seq<1000 then lpad(seq::text,3,'0') else seq::text end,p_data);
 end if;
 delete from public.photos where garment_id=p_id and user_id=u;
 for ph in select value from jsonb_array_elements(p_photos) loop
   if ph->>'path' is distinct from u::text||'/'||(ph->>'id')||'.jpg'
      or not exists(select 1 from storage.objects where bucket_id='wardrobe' and name=ph->>'path') then raise exception '照片缺失或无权使用'; end if;
   insert into public.photos(id,user_id,garment_id,path,size,width,height,position)
    values((ph->>'id')::uuid,u,p_id,ph->>'path',(ph->>'size')::int,(ph->>'width')::int,(ph->>'height')::int,(ph->>'position')::int);
 end loop;
 return p_id;
end $$;

create function public.delete_garments(p_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception '请先登录'; end if;
 delete from public.garments where user_id=auth.uid() and id=any(p_ids);
end $$;
create function public.save_profile(p_data jsonb,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare current_version integer;
begin
 if auth.uid() is null then raise exception '请先登录'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 select version into current_version from public.profiles where user_id=auth.uid() for update;
 if coalesce(current_version,0)<>p_version then raise exception '风格档案已更新，请刷新后重试'; end if;
 insert into public.profiles(user_id,data) values(auth.uid(),p_data)
 on conflict(user_id) do update set data=excluded.data,version=public.profiles.version+1,updated_at=now();
end $$;

-- 恢复为单次数据库事务：同 UUID 且内容相同则跳过；有任何冲突则全部回滚。
-- 不覆盖现有记录；照片先上传，元数据最后提交。重复执行可安全重试。
create function public.restore_archive(p_archive jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); g jsonb; ph jsonb; old public.garments; pref text; seq bigint; n integer:=0; cat jsonb;
begin
 if u is null then raise exception '请先登录'; end if;
 if p_archive->>'format' is distinct from 'my-style-archive' or p_archive->>'version' is distinct from '1'
 or jsonb_typeof(p_archive->'garments') is distinct from 'array' then raise exception '备份格式不正确'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,2));
 for g in select value from jsonb_array_elements(p_archive->'garments') loop
   select * into old from public.garments where id=(g->>'id')::uuid for update;
   if found then
     if old.user_id<>u or old.code<>g->>'code' or old.data<>g->'data' then raise exception '记录冲突：%，恢复已取消',g->>'code'; end if;
     if (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'size',p.size,'width',p.width,'height',p.height,'position',p.position) order by p.position),'[]') from public.photos p where garment_id=old.id)
       <> (select coalesce(jsonb_agg(jsonb_build_object('id',x->'id','size',x->'size','width',x->'width','height',x->'height','position',x->'position') order by (x->>'position')::int),'[]') from jsonb_array_elements(g->'photos') x)
       then raise exception '照片记录冲突：%',g->>'code'; end if;
     continue;
   end if;
   if exists(select 1 from public.garments where user_id=u and code=g->>'code') then raise exception '编号冲突：%',g->>'code'; end if;
   insert into public.garments(id,user_id,code,data,version,created_at,updated_at)
    values((g->>'id')::uuid,u,g->>'code',g->'data',1,(g->>'created_at')::timestamptz,(g->>'updated_at')::timestamptz);
   if jsonb_typeof(g->'photos') is distinct from 'array' or jsonb_array_length(g->'photos')>12 then raise exception '照片数量错误'; end if;
   for ph in select value from jsonb_array_elements(g->'photos') loop
     if not exists(select 1 from storage.objects where bucket_id='wardrobe' and name=u::text||'/'||(ph->>'id')||'.jpg') then raise exception '照片文件缺失'; end if;
     insert into public.photos(id,user_id,garment_id,path,size,width,height,position)
       values((ph->>'id')::uuid,u,(g->>'id')::uuid,u::text||'/'||(ph->>'id')||'.jpg',(ph->>'size')::int,(ph->>'width')::int,(ph->>'height')::int,(ph->>'position')::int);
   end loop;
   pref:=substring(g->>'code' from '^[A-Z]+'); seq:=substring(g->>'code' from '[0-9]+$')::bigint;
   insert into public.number_counters values(u,pref,seq) on conflict(user_id,prefix) do update set last_value=greatest(public.number_counters.last_value,excluded.last_value);
   n:=n+1;
 end loop;
 -- 备份必须保留已删除衣服使用过的最大编号，防止恢复后复用。
 for cat in select value from jsonb_array_elements(coalesce(p_archive->'counters','[]')) loop
   if cat->>'prefix' !~ '^[A-Z]{1,3}$' then raise exception '编号前缀错误'; end if;
   insert into public.number_counters values(u,cat->>'prefix',(cat->>'last_value')::bigint)
    on conflict(user_id,prefix) do update set last_value=greatest(public.number_counters.last_value,excluded.last_value);
 end loop;
 if p_archive->'profile' <> 'null'::jsonb then
   insert into public.profiles(user_id,data) values(u,p_archive->'profile') on conflict(user_id) do nothing;
 end if;
 for cat in select value from jsonb_array_elements(p_archive->'categories') loop
   insert into public.categories values(u,cat#>>'{}') on conflict do nothing;
 end loop;
 return n;
end $$;
create function public.export_archive() returns jsonb language sql security definer set search_path='' as $$
select case when auth.uid() is null then null else jsonb_build_object(
 'format','my-style-archive','version',1,'exported_at',now(),
 'garments',coalesce((select jsonb_agg((to_jsonb(g)-'user_id')||jsonb_build_object('photos',coalesce((select jsonb_agg(to_jsonb(p)-'user_id'-'garment_id' order by position) from public.photos p where p.garment_id=g.id),'[]'))) from public.garments g where g.user_id=auth.uid()),'[]'),
 'profile',(select data from public.profiles where user_id=auth.uid()),
 'categories',coalesce((select jsonb_agg(name) from public.categories where user_id=auth.uid()),'[]'),
 'counters',coalesce((select jsonb_agg(jsonb_build_object('prefix',prefix,'last_value',last_value)) from public.number_counters where user_id=auth.uid()),'[]')
) end;
$$;
revoke all on function public.save_garment(uuid,jsonb,jsonb,integer),public.delete_garments(uuid[]),public.save_profile(jsonb,integer),public.restore_archive(jsonb),public.export_archive() from public,anon;
grant execute on function public.save_garment(uuid,jsonb,jsonb,integer),public.delete_garments(uuid[]),public.save_profile(jsonb,integer),public.restore_archive(jsonb),public.export_archive() to authenticated;
commit;
