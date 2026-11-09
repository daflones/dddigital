-- Discodigital server branding + anonymous invite preview.
begin;

alter table public.ddtal_servers
  add column icon_url text check (icon_url is null or icon_url ~ '^[0-9a-f-]{36}/icon\.(webp|png|jpg|jpeg|gif)$'),
  add column name_color text check (name_color is null or name_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column name_effect text not null default 'none' check (name_effect in ('none','glow','pulse','rainbow','wave')),
  add column name_font text not null default 'default' check (name_font in ('default','mono','pixel','script'));

-- Public bucket for server icons; only the server staff writes inside <server id>/.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('ddtal-server-assets','ddtal-server-assets',true,8388608,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy ddtal_server_assets_read on storage.objects for select to public
  using (bucket_id='ddtal-server-assets');
create policy ddtal_server_assets_write on storage.objects for insert to authenticated
  with check (bucket_id='ddtal-server-assets' and char_length(name) <= 80
    and public.ddtal_is_staff((storage.foldername(name))[1]::uuid));
create policy ddtal_server_assets_update on storage.objects for update to authenticated
  using (bucket_id='ddtal-server-assets' and public.ddtal_is_staff((storage.foldername(name))[1]::uuid));
create policy ddtal_server_assets_delete on storage.objects for delete to authenticated
  using (bucket_id='ddtal-server-assets' and public.ddtal_is_staff((storage.foldername(name))[1]::uuid));

create policy ddtal_servers_update on public.ddtal_servers for update to authenticated
  using (public.ddtal_is_staff(id)) with check (public.ddtal_is_staff(id));
grant update(name,description,icon_url,name_color,name_effect,name_font) on public.ddtal_servers to authenticated;

-- Anonymous invite card: name, icon, inviter and member count before signing up.
create or replace function public.ddtal_invite_preview(p_invite uuid) returns json
language plpgsql stable security definer set search_path = '' as $$
declare invite record; srv record; inviter record;
begin
  select * into invite from public.ddtal_invites where id = p_invite;
  if not found then raise exception 'Convite não encontrado.'; end if;
  if invite.expires_at < now() or invite.uses >= invite.max_uses then
    raise exception 'Este convite expirou ou atingiu o limite de usos.';
  end if;
  select * into srv from public.ddtal_servers where id = invite.server_id;
  select display_name, avatar_url, name_color, name_effect, name_font into inviter
    from public.ddtal_profiles where id = invite.created_by;
  return json_build_object(
    'server_id', srv.id, 'name', srv.name, 'description', srv.description,
    'icon_url', srv.icon_url, 'name_color', srv.name_color,
    'name_effect', srv.name_effect, 'name_font', srv.name_font,
    'inviter', inviter.display_name, 'inviter_avatar', inviter.avatar_url,
    'members', (select count(*) from public.ddtal_members where server_id = srv.id));
end $$;
revoke all on function public.ddtal_invite_preview(uuid) from public;
grant execute on function public.ddtal_invite_preview(uuid) to anon, authenticated, service_role;

commit;
