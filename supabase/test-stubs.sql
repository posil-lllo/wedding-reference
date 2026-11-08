-- 테스트용 Supabase 흉내: 빈 Postgres 에 이것, schema.sql, *.test.sql 순서로 올림
-- request.uid / request.anon 설정값이 로그인한 사용자 id / 익명 로그인 여부를 대신함
create role anon; create role authenticated;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('is_anonymous', coalesce(nullif(current_setting('request.anon', true), ''), 'false')::boolean) $$;
grant usage on schema auth to authenticated, anon; grant execute on all functions in schema auth to authenticated, anon;
create schema storage;
create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
grant usage on schema storage, public to authenticated, anon; grant select, insert, delete on storage.objects to authenticated;
