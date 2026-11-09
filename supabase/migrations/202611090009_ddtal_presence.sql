-- Discodigital (ddtal): presence status per profile. online = rings and
-- notifications; busy/away/offline = silent (offline also acts invisible).
alter table public.ddtal_profiles
  add column if not exists presence text not null default 'online'
  check (presence in ('online','busy','away','offline'));
grant update (presence) on public.ddtal_profiles to authenticated;
