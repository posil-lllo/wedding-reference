-- 체크리스트 RLS 확인. 실행: 빈 Postgres 에 test-stubs.sql, schema.sql 을 올린 뒤 psql -v ON_ERROR_STOP=1 -f supabase/checklist.test.sql
begin;
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000000'), ('bbbbbbbb-0000-0000-0000-000000000000'), ('99999999-0000-0000-0000-000000000000');
create function pg_temp.as_user(uid text, anon boolean default false) returns void language sql as $$
  select set_config('request.uid', uid, true), set_config('request.anon', anon::text, true), set_config('role', 'authenticated', true)
$$;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;

select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000000') \gset
insert into public.checklists (data) values ('{"at":1}');
insert into public.checklists (user_id, data) values ('aaaaaaaa-0000-0000-0000-000000000000', '{"at":2}')
  on conflict (user_id) do update set data = excluded.data; -- 브라우저의 upsert
do $$ begin
  assert (select data ->> 'at' from public.checklists) = '2', 'owner upserts own checklist';
  assert pg_temp.fails($q$ insert into public.checklists (user_id, data) values ('bbbbbbbb-0000-0000-0000-000000000000', '{}') $q$), 'cannot write for others';
  assert pg_temp.fails($q$ update public.checklists set data = jsonb_build_object('x', repeat('a', 300001)) $q$), 'oversized rejected';
end $$;

select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000000') \gset
do $$ begin
  assert (select count(*) from public.checklists) = 0, 'other user sees nothing';
end $$;

select pg_temp.as_user('99999999-0000-0000-0000-000000000000', true) \gset
do $$ begin
  assert pg_temp.fails($q$ insert into public.checklists (data) values ('{}') $q$), 'anonymous cannot save';
end $$;
select 'checklist tests ok';
rollback;
