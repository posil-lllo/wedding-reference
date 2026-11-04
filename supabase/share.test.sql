-- 레퍼런스 공유 RLS 확인. 실행: 빈 Postgres 에 auth·storage 스텁과 schema.sql 을 올린 뒤 psql -v ON_ERROR_STOP=1 -f supabase/share.test.sql
-- A·B 는 공유한 사람, C 는 공유하지 않은 사람
begin;
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000000'), ('bbbbbbbb-0000-0000-0000-000000000000'), ('cccccccc-0000-0000-0000-000000000000');
create function pg_temp.photos(uid text, n int) returns jsonb language sql as $$
  select jsonb_build_object('dress', jsonb_agg(jsonb_build_object('imgs', jsonb_build_array('sb:' || uid || '/' || i || '.jpg')))) from generate_series(1, n) i
$$;
create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.uid', uid, true), set_config('role', 'authenticated', true)
$$;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;

-- A: 사진 10장 시안 공유 + 공유하지 않은 비밀 사진. 원작자가 고쳐도 공유본은 그대로
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000000') \gset
insert into public.drafts (id, data) values ('a1', pg_temp.photos('aaaaaaaa-0000-0000-0000-000000000000', 10) || '{"basic":{"groom":"철수"}}');
insert into public.shares (draft_id, data) select 'a1', data - 'basic' from public.drafts where id = 'a1';
update public.drafts set data = '{}' where id = 'a1';
do $$ begin assert (select public.photo_paths(data) from public.shares limit 1) is not null, 'snapshot kept'; end $$;

-- 거부: 9장, basic 포함, 남의 사진 경로 (대조: 그대로 다시 저장하면 통과)
do $$ begin
  assert not pg_temp.fails($q$ update public.shares set data = data $q$), 'valid update passes';
  assert pg_temp.fails($q$ update public.shares set data = pg_temp.photos('aaaaaaaa-0000-0000-0000-000000000000', 9) $q$), '9 photos rejected';
  assert pg_temp.fails($q$ update public.shares set data = data || '{"basic":{}}' $q$), 'basic rejected';
  assert pg_temp.fails($q$ update public.shares set data = pg_temp.photos('bbbbbbbb-0000-0000-0000-000000000000', 10) $q$), 'foreign paths rejected';
end $$;

-- B 공유
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000000') \gset
insert into public.drafts (id, data) values ('b1', pg_temp.photos('bbbbbbbb-0000-0000-0000-000000000000', 12));
insert into public.shares (draft_id, data) select 'b1', data from public.drafts where id = 'b1';
do $$ begin
  assert (select count(*) from public.shared_drafts()) = 1, 'B sees only A';
  assert (select nickname from public.shared_drafts()) = '', 'no profile -> empty nickname';
  assert public.is_shared_photo('aaaaaaaa-0000-0000-0000-000000000000/3.jpg'), 'B reads A shared photo';
  assert not public.is_shared_photo('aaaaaaaa-0000-0000-0000-000000000000/secret.jpg'), 'B cannot read A unshared photo';
  assert (select count(*) from public.shares) = 1, 'B sees only own share row directly';
end $$;

-- C 는 못 봄
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000000') \gset
do $$ begin
  assert pg_temp.fails('select * from public.shared_drafts()'), 'C blocked';
  assert not public.is_shared_photo('aaaaaaaa-0000-0000-0000-000000000000/3.jpg'), 'C cannot read photo';
end $$;

-- B 가 원본을 지우면 공유도 내려가고 자격이 사라짐
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000000') \gset
delete from public.drafts where id = 'b1';
do $$ begin assert pg_temp.fails('select * from public.shared_drafts()'), 'B lost access after delete'; end $$;
rollback;
\echo share tests ok
