-- 로그인 사용자의 촬영 시안과 사진 저장소. Supabase SQL Editor 에서 한 번 실행

-- 시안: 입력값(JSON). 사진은 data 안에 'sb:<사용자 id>/<해시>.jpg' 경로로만 들어감
create table public.drafts (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  name text not null default '',
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.drafts enable row level security;
create policy "own drafts" on public.drafts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.drafts from anon;
grant select, insert, update, delete on public.drafts to authenticated;

-- 서버 용량 때문에 계정당 시안 2개까지. 기존 시안 저장(upsert)은 자기 자신을 빼고 세므로 통과
create function public.limit_drafts() returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text)); -- 동시에 두 개 만드는 경우 차례로 셈
  if (select count(*) from public.drafts where user_id = new.user_id and id <> new.id) >= 2 then
    raise exception 'draft limit reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger limit_drafts before insert on public.drafts
  for each row execute function public.limit_drafts();

-- 사진: 비공개 버킷, 본인 폴더(<사용자 id>/)만 읽고 쓰고 지움
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg']);
create policy "own photos read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 사용자 프로필: 처음 로그인할 때 닉네임과 신랑·신부를 받음. character 는 성향 테스트 결과(나중에 채움)
create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  role text not null check (role in ('groom', 'bride')),
  character text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;
-- 닉네임은 사용자끼리 겹치지 않음 (영문 대소문자는 같은 것으로 봄)
create unique index profiles_nickname_key on public.profiles (lower(nickname));
-- 결혼 예정일. wedding_date_range 는 날짜 오차(개월), 0 은 정확한 날짜
alter table public.profiles
  add column wedding_date date,
  add column wedding_date_range smallint check (wedding_date_range in (0, 1, 3));

-- 문의하기(inquiry.js): 로그인 없이도 넣을 수만 있고 읽기·수정은 막힘. 확인은 대시보드(Table Editor)에서
-- kind: error 에러 / improve 개선 요청 / feedback 피드백 / etc 기타, service: mbti 성향 테스트 / reference 시안 만들기
create table public.inquiries (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users on delete set null,
  kind text not null check (kind in ('error', 'improve', 'feedback', 'etc')),
  service text not null check (service in ('mbti', 'reference')),
  body text not null check (char_length(body) between 1 and 2000),
  photos text[] not null default '{}' check (cardinality(photos) <= 2), -- inquiries 버킷 안 경로
  contact text check (char_length(contact) <= 100),
  occurred text check (char_length(occurred) <= 100), -- 문제가 생긴 시간. 사용자가 대략 적는 자유 문구
  page text check (char_length(page) <= 300),
  created_at timestamptz not null default now()
);
alter table public.inquiries enable row level security;
create policy "anyone submits" on public.inquiries for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
revoke all on public.inquiries from anon, authenticated;
grant insert on public.inquiries to anon, authenticated;

-- 문의 참고 사진: 비공개 버킷, 올리기만 됨. 브라우저에서 긴 변 1600px JPEG 로 줄여 올리므로 2MB 면 충분
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inquiries', 'inquiries', false, 2097152, array['image/jpeg']);
create policy "anyone uploads inquiry photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'inquiries');

-- 레퍼런스 공유: 공유하기를 누른 순간의 시안을 공유본(shares)으로 따로 저장. 원본을 고쳐도 공유본은 그대로이고 '공유 다시 하기'로만 바뀜
-- 공유본이 하나라도 있는 사람만 남의 공유본을 보고 통째로 가져갈 수 있음. 자격은 공유를 내리거나 원본 시안을 지울 때만 사라짐
-- 품질 기준: 서로 다른 사진 10장 이상. 10 을 바꾸면 account.js 의 SHARE_MIN_PHOTOS 도 같이 바꿀 것
create function public.photo_paths(d jsonb) returns setof text language sql immutable set search_path = '' as $$
  select distinct substr(v #>> '{}', 4) from jsonb_path_query(d, 'lax $.** ? (@.type() == "string" && @ starts with "sb:")') v
$$;
-- 공유본의 사진은 모두 본인 폴더여야 함 (남의 사진 경로를 적어 넣어 그 사진을 읽는 것을 막음)
create function public.share_data_ok(d jsonb, uid uuid) returns boolean language sql immutable set search_path = '' as $$
  select not (d ? 'basic') -- 신랑·신부 이름, 촬영일은 빼고 올림
    and (select count(*) from public.photo_paths(d)) >= 10
    and not exists (select 1 from public.photo_paths(d) p where p not like uid::text || '/%')
$$;

create table public.shares (
  user_id uuid not null default auth.uid(),
  draft_id text not null,
  data jsonb not null,
  shared_at timestamptz not null default now(),
  primary key (user_id, draft_id),
  foreign key (user_id, draft_id) references public.drafts (user_id, id) on delete cascade, -- 원본을 지우면 공유도 내려감
  check (public.share_data_ok(data, user_id))
);
alter table public.shares enable row level security;
create policy "own shares" on public.shares for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.shares from anon;
grant select, insert, update, delete on public.shares to authenticated;

-- shares RLS 는 본인 행만 보이므로 남의 공유본은 아래 security definer 함수로만 봄
create function public.is_sharer() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shares where user_id = auth.uid())
$$;
-- ponytail: 최근 200개까지만, 공유가 많아지면 페이지 나누기
create function public.shared_drafts() returns table (user_id uuid, draft_id text, nickname text, shared_at timestamptz, data jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_sharer() then
    raise exception 'share required' using errcode = 'P0001';
  end if;
  return query
    select s.user_id, s.draft_id, coalesce(p.nickname, ''), s.shared_at, s.data
    from public.shares s left join public.profiles p on p.user_id = s.user_id
    where s.user_id <> auth.uid()
    order by s.shared_at desc limit 200;
end $$;
revoke execute on function public.shared_drafts() from public, anon;
grant execute on function public.shared_drafts() to authenticated;

-- 공유본에 들어 있는 사진은 공유한 사람이 읽을 수 있음 (공유하지 않은 사진은 그대로 막힘)
-- ponytail: 사진 하나마다 공유본 전체를 훑음. 공유가 수천 개가 되면 공유 사진 경로 테이블로 바꿀 것
create function public.is_shared_photo(path text) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_sharer() and exists (
    select 1 from public.shares s where jsonb_path_exists(s.data, 'lax $.** ? (@ == $p)', jsonb_build_object('p', 'sb:' || path)))
$$;
create policy "shared photos read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_shared_photo(name));
