-- 초대 RLS 확인. 실행: 빈 Postgres 에 test-stubs.sql, schema.sql 을 올린 뒤 psql -v ON_ERROR_STOP=1 -f supabase/invite.test.sql
-- A 는 시안 주인, G 는 익명 로그인으로 초대받은 사람, M 은 카카오 로그인으로 초대받은 사람, X 는 코드를 모르는 사람
begin;
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000000'), ('99999999-0000-0000-0000-000000000000'),
  ('dddddddd-0000-0000-0000-000000000000'), ('eeeeeeee-0000-0000-0000-000000000000');
create function pg_temp.as_user(uid text, anon boolean default false) returns void language sql as $$
  select set_config('request.uid', uid, true), set_config('request.anon', anon::text, true), set_config('role', 'authenticated', true)
$$;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;

-- A: 시안(이름·촬영일 포함)과 초대. 시안에 남의 사진 경로를 적어 넣어도 그 사진은 안 열림
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000000') \gset
insert into public.drafts (id, data) values ('a1', '{"basic":{"groom":"철수"},"dress":{"imgs":["sb:aaaaaaaa-0000-0000-0000-000000000000/1.jpg","sb:dddddddd-0000-0000-0000-000000000000/x.jpg"]}}');
insert into public.drafts (id, data) values ('a2', '{"dress":{"imgs":["sb:aaaaaaaa-0000-0000-0000-000000000000/2.jpg"]}}');
insert into public.invites (code, draft_id) values ('ABCD2345', 'a1');
do $$ begin
  assert pg_temp.fails($q$ insert into public.invites (code, draft_id) values ('abcd0001', 'a2') $q$), 'bad code format rejected';
  assert (select name from public.join_invite('ABCD2345')) = '', 'owner can open own link';
  assert (select count(*) from public.invited_drafts()) = 0, 'owner is not recorded as guest';
end $$;

-- G: 익명. 소문자로 쳐도 들어옴. 원본을 그대로 봄(이름 포함), 사진은 초대 시안의 주인 사진만
select pg_temp.as_user('99999999-0000-0000-0000-000000000000', true) \gset
do $$ begin
  assert (select data #>> '{basic,groom}' from public.join_invite('abcd2345')) = '철수', 'guest sees live draft with basic';
  assert public.is_invited_photo('aaaaaaaa-0000-0000-0000-000000000000/1.jpg'), 'guest reads invited photo';
  assert not public.is_invited_photo('aaaaaaaa-0000-0000-0000-000000000000/2.jpg'), 'guest cannot read photo of other draft';
  assert not public.is_invited_photo('dddddddd-0000-0000-0000-000000000000/x.jpg'), 'guest cannot read foreign path planted in draft';
  assert pg_temp.fails($q$ select * from public.join_invite('ZZZZ2345') $q$), 'unknown code rejected';
  -- 익명은 보기만
  assert pg_temp.fails($q$ insert into public.drafts (id, data) values ('g1', '{}') $q$), 'anon cannot create draft';
  assert pg_temp.fails($q$ insert into storage.objects values ('photos', '99999999-0000-0000-0000-000000000000/1.jpg') $q$), 'anon cannot upload photo';
  assert pg_temp.fails($q$ insert into public.profiles (nickname, role) values ('g', 'groom') $q$), 'anon cannot create profile';
  assert pg_temp.fails($q$ select * from public.invite_guests $q$), 'guest table not readable directly';
end $$;

-- M: 카카오 로그인한 사람은 마이페이지 목록에 남음. A 가 시안을 고치면 바로 보임
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000000') \gset
select from public.join_invite('ABCD2345');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000000') \gset
update public.drafts set name = '새 이름' where id = 'a1';
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000000') \gset
do $$ begin
  assert (select name from public.invited_drafts()) = '새 이름', 'member sees latest draft in list';
  assert (select count(*) from public.invites) = 0, 'member cannot see others invites';
end $$;

-- X: 코드를 모르면 사진도 못 봄
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000000') \gset
do $$ begin
  assert not public.is_invited_photo('aaaaaaaa-0000-0000-0000-000000000000/1.jpg'), 'stranger cannot read photo';
  assert (select count(*) from public.invited_drafts()) = 0, 'stranger has no invites';
end $$;

-- A 가 초대를 끊으면 받은 사람 모두 못 봄
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000000') \gset
delete from public.invites where code = 'ABCD2345';
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000000') \gset
do $$ begin
  assert (select count(*) from public.invited_drafts()) = 0, 'revoked invite gone from list';
  assert not public.is_invited_photo('aaaaaaaa-0000-0000-0000-000000000000/1.jpg'), 'revoked photo blocked';
end $$;
rollback;
\echo invite tests ok
