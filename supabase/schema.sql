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
