-- Discodigital profile card: status, bio, banner and avatar/card decorations.
begin;

alter table public.ddtal_profiles
  add column status_text text not null default '' check (char_length(status_text) <= 120),
  add column bio text not null default '' check (char_length(bio) <= 500),
  add column banner_url text,
  add column avatar_frame text not null default 'none'
    check (avatar_frame in ('none','ring','glow','rainbow','cyber','dashed','gold')),
  add column card_effect text not null default 'none'
    check (card_effect in ('none','scanlines','grid','aurora','matrix','vapor')),
  add column card_color text check (card_color is null or card_color ~ '^#[0-9A-Fa-f]{6}$');

-- Avatar/banner may point at a bucket object (<uid>/avatar.<ext>, <uid>/banner.<ext>)
-- or an external https URL (e.g. a GIF picked from a search provider).
alter table public.ddtal_profiles drop constraint ddtal_profiles_avatar_url_check;
alter table public.ddtal_profiles add constraint ddtal_profiles_avatar_url_check check (
  avatar_url is null or (avatar_url ~ '^(https://[a-z0-9.-]+(:[0-9]+)?/[^ <>"'']*|[0-9a-f-]{36}/avatar\.(webp|png|jpg|jpeg|gif))$' and char_length(avatar_url) <= 2100));
alter table public.ddtal_profiles add constraint ddtal_profiles_banner_url_check check (
  banner_url is null or (banner_url ~ '^(https://[a-z0-9.-]+(:[0-9]+)?/[^ <>"'']*|[0-9a-f-]{36}/banner\.(webp|png|jpg|jpeg|gif))$' and char_length(banner_url) <= 2100));

grant update(status_text,bio,banner_url,avatar_frame,card_effect,card_color) on public.ddtal_profiles to authenticated;

commit;
