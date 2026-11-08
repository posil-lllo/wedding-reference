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

-- 초대: 시안 하나를 링크·QR·코드로 보여 줌 (보기만). 신랑, 메이크업샵처럼 그 시안을 같이 봐야 하는 사람에게 보냄
-- 원본 시안을 그대로 보여 줘서 고친 내용이 바로 보이고, 신랑·신부 이름과 촬영일도 보임
-- 로그인하지 않은 사람은 브라우저가 익명 로그인(Supabase Auth 설정의 Anonymous sign-ins 를 켜야 함)해서 봄
-- 초대를 끊으면(행 삭제) 받은 사람 모두 더 못 봄. 시안을 지워도 같이 끊김
create table public.invites (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'), -- 브라우저가 헷갈리는 글자(I, O, 0, 1)를 빼고 만듦
  user_id uuid not null default auth.uid(),
  draft_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, draft_id),
  foreign key (user_id, draft_id) references public.drafts (user_id, id) on delete cascade
);
alter table public.invites enable row level security;
create policy "own invites" on public.invites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.invites from anon;
grant select, insert, delete on public.invites to authenticated;

-- 초대받은 사람. 정책이 없어 직접은 못 읽고 쓰며 아래 함수로만 다룸
create table public.invite_guests (
  code text not null references public.invites on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (code, user_id)
);
alter table public.invite_guests enable row level security;
revoke all on public.invite_guests from anon, authenticated;

-- 초대 코드로 들어옴: 받은 사람으로 기록하고 그 시안을 돌려줌. 자기 초대 링크를 연 주인은 기록하지 않고 보여만 줌
create function public.join_invite(c text) returns table (code text, nickname text, name text, data jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.invite_guests (code, user_id)
    select i.code, auth.uid() from public.invites i where i.code = upper(c) and i.user_id <> auth.uid()
    on conflict do nothing;
  return query
    select i.code, coalesce(p.nickname, ''), d.name, d.data, d.updated_at
    from public.invites i
    join public.drafts d on d.user_id = i.user_id and d.id = i.draft_id
    left join public.profiles p on p.user_id = i.user_id
    where i.code = upper(c);
  if not found then
    raise exception 'invite not found' using errcode = 'P0001';
  end if;
end $$;
-- 마이페이지 '공유받은 시안'
create function public.invited_drafts() returns table (code text, nickname text, name text, data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.code, coalesce(p.nickname, ''), d.name, d.data, d.updated_at
  from public.invite_guests g
  join public.invites i on i.code = g.code
  join public.drafts d on d.user_id = i.user_id and d.id = i.draft_id
  left join public.profiles p on p.user_id = i.user_id
  where g.user_id = auth.uid()
  order by g.joined_at desc
$$;
revoke execute on function public.join_invite(text), public.invited_drafts() from public, anon;
grant execute on function public.join_invite(text), public.invited_drafts() to authenticated;

-- 받은 초대의 시안에 들어 있는 사진은 읽을 수 있음. 시안 주인 폴더의 사진만 (시안에 남의 사진 경로를 적어 넣어 읽는 것을 막음)
create function public.is_invited_photo(path text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.invite_guests g
    join public.invites i on i.code = g.code
    join public.drafts d on d.user_id = i.user_id and d.id = i.draft_id
    where g.user_id = auth.uid() and path like i.user_id::text || '/%'
      and jsonb_path_exists(d.data, 'lax $.** ? (@ == $p)', jsonb_build_object('p', 'sb:' || path)))
$$;
create policy "invited photos read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_invited_photo(name));

-- 익명 로그인한 사람은 보기만. 시안·프로필·초대 만들기와 사진 올리기는 카카오로 로그인한 사람만
create policy "members only" on public.drafts as restrictive for all to authenticated
  using ((auth.jwt() ->> 'is_anonymous')::boolean is not true);
create policy "members only" on public.profiles as restrictive for all to authenticated
  using ((auth.jwt() ->> 'is_anonymous')::boolean is not true);
create policy "members only" on public.invites as restrictive for all to authenticated
  using ((auth.jwt() ->> 'is_anonymous')::boolean is not true);
create policy "members only photos insert" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'photos' or (auth.jwt() ->> 'is_anonymous')::boolean is not true);

-- 성향 테스트 결과: 카카오 로그인한 사람이 테스트를 끝낼 때마다 한 줄씩 쌓음. 최신 결과는 profiles.character 에도 적음
create table public.test_results (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  character text not null,          -- 캐릭터 키 (mbti/data.js CHARACTERS)
  value text not null,              -- 가치관 축 결과 (R/G/M/S)
  gender text,
  answers jsonb not null,           -- [{ q: 문항, a: 고른 답, i: 답 번호 }]
  value_percent jsonb not null,     -- 가치관 축별 % (합 100)
  style_percent jsonb not null,     -- 스타일 축별 % (합 100)
  created_at timestamptz not null default now()
);
create index on public.test_results (user_id, created_at desc);
alter table public.test_results enable row level security;
create policy "own results" on public.test_results for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members only" on public.test_results as restrictive for all to authenticated
  using ((auth.jwt() ->> 'is_anonymous')::boolean is not true);
revoke all on public.test_results from anon;
grant select, insert on public.test_results to authenticated;

-- 결혼 준비 체크리스트: 계정당 하나. 브라우저 저장값(checklist/app.js state)을 그대로 넣음
create table public.checklists (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null check (octet_length(data::text) <= 300000), -- 기본 항목이 약 20KB. 마구 커지는 것만 막음
  updated_at timestamptz not null default now()
);
alter table public.checklists enable row level security;
create policy "own checklist" on public.checklists for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members only" on public.checklists as restrictive for all to authenticated
  using ((auth.jwt() ->> 'is_anonymous')::boolean is not true);
revoke all on public.checklists from anon;
grant select, insert, update on public.checklists to authenticated;
