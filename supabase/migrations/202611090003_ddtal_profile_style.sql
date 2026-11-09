-- Discodigital profile customization: avatar + display-name styling.
begin;

alter table public.ddtal_profiles
  add column avatar_url text check (avatar_url is null or avatar_url ~ '^[0-9a-f-]{36}/avatar\.(webp|png|jpg|jpeg|gif)$'),
  add column name_color text check (name_color is null or name_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column name_effect text not null default 'none' check (name_effect in ('none','glow','pulse','rainbow','wave')),
  add column name_font text not null default 'default' check (name_font in ('default','mono','pixel','script'));

-- Public avatars bucket; path is <user id>/avatar.<ext> so ownership is enforced by folder.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('ddtal-avatars','ddtal-avatars',true,5242880,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy ddtal_avatars_read on storage.objects for select to public
  using (bucket_id='ddtal-avatars');
create policy ddtal_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id='ddtal-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text and char_length(name)<=80);
create policy ddtal_avatars_update on storage.objects for update to authenticated
  using (bucket_id='ddtal-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy ddtal_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id='ddtal-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

grant update(avatar_url,name_color,name_effect,name_font) on public.ddtal_profiles to authenticated;

commit;
