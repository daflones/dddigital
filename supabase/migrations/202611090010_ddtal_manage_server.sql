-- Discodigital "manage server" permission: role flag gating server branding edits.
begin;

alter table public.ddtal_roles
  add column manage_server boolean not null default false; -- edit server name/icon/description/branding

create or replace function public.ddtal_has_perm(p_server uuid, p_user uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.ddtal_members m where m.server_id=p_server and m.user_id=p_user and m.role in ('owner','moderator'))
    or exists(select 1 from public.ddtal_member_roles mr
       join public.ddtal_roles r on r.id=mr.role_id
       where mr.server_id=p_server and mr.user_id=p_user
         and case p_perm
           when 'moderate_voice' then r.moderate_voice
           when 'manage_channels' then r.manage_channels
           when 'manage_roles' then r.manage_roles
           when 'manage_invites' then r.manage_invites
           when 'kick_members' then r.kick_members
           when 'edit_notes' then r.edit_notes
           when 'manage_nicknames' then r.manage_nicknames
           when 'manage_server' then r.manage_server
           else false end)
$$;

-- Server edits (name, icon, description, branding) now require the manage_server
-- permission: owner/moderator implicitly, or a role with the flag.
drop policy ddtal_servers_update on public.ddtal_servers;
create policy ddtal_servers_update on public.ddtal_servers for update to authenticated
  using (public.ddtal_has_perm(id,(select auth.uid()),'manage_server'))
  with check (public.ddtal_has_perm(id,(select auth.uid()),'manage_server'));

-- Same gate for uploading the server icon/banner into the assets bucket.
drop policy ddtal_server_assets_write on storage.objects;
create policy ddtal_server_assets_write on storage.objects for insert to authenticated
  with check (bucket_id='ddtal-server-assets' and char_length(name) <= 80
    and public.ddtal_has_perm((storage.foldername(name))[1]::uuid,(select auth.uid()),'manage_server'));
drop policy ddtal_server_assets_update on storage.objects;
create policy ddtal_server_assets_update on storage.objects for update to authenticated
  using (bucket_id='ddtal-server-assets' and public.ddtal_has_perm((storage.foldername(name))[1]::uuid,(select auth.uid()),'manage_server'));
drop policy ddtal_server_assets_delete on storage.objects;
create policy ddtal_server_assets_delete on storage.objects for delete to authenticated
  using (bucket_id='ddtal-server-assets' and public.ddtal_has_perm((storage.foldername(name))[1]::uuid,(select auth.uid()),'manage_server'));

-- Role create/update RPCs learn the new flag.
create or replace function public.ddtal_create_role(p_server uuid, p_name text, p_color text, p_flags jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not public.ddtal_has_perm(p_server, auth.uid(), 'manage_roles') then raise exception 'Sem permissão para criar cargos.'; end if;
  insert into public.ddtal_roles(server_id,name,color,position,
    moderate_voice,manage_channels,manage_roles,manage_invites,kick_members,edit_notes,manage_nicknames,manage_server)
  values(p_server, left(trim(p_name),40), coalesce(p_color,'#b69afb'),
    coalesce((select max(position) from public.ddtal_roles where server_id=p_server),0)+1,
    coalesce((p_flags->>'moderate_voice')::boolean,false), coalesce((p_flags->>'manage_channels')::boolean,false),
    coalesce((p_flags->>'manage_roles')::boolean,false), coalesce((p_flags->>'manage_invites')::boolean,false),
    coalesce((p_flags->>'kick_members')::boolean,false), coalesce((p_flags->>'edit_notes')::boolean,false),
    coalesce((p_flags->>'manage_nicknames')::boolean,false), coalesce((p_flags->>'manage_server')::boolean,false))
  returning id into rid;
  return rid;
end $$;

create or replace function public.ddtal_update_role(p_role uuid, p_name text, p_color text, p_flags jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select server_id into sid from public.ddtal_roles where id=p_role;
  if sid is null then raise exception 'Cargo não encontrado.'; end if;
  if not public.ddtal_has_perm(sid, auth.uid(), 'manage_roles') then raise exception 'Sem permissão para editar cargos.'; end if;
  update public.ddtal_roles set name=left(trim(p_name),40), color=coalesce(p_color,color),
    moderate_voice=coalesce((p_flags->>'moderate_voice')::boolean,moderate_voice),
    manage_channels=coalesce((p_flags->>'manage_channels')::boolean,manage_channels),
    manage_roles=coalesce((p_flags->>'manage_roles')::boolean,manage_roles),
    manage_invites=coalesce((p_flags->>'manage_invites')::boolean,manage_invites),
    kick_members=coalesce((p_flags->>'kick_members')::boolean,kick_members),
    edit_notes=coalesce((p_flags->>'edit_notes')::boolean,edit_notes),
    manage_nicknames=coalesce((p_flags->>'manage_nicknames')::boolean,manage_nicknames),
    manage_server=coalesce((p_flags->>'manage_server')::boolean,manage_server)
  where id=p_role;
end $$;

do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'ddtal_%'
  loop
    execute format('revoke all on function %s from public, anon',fn.signature);
    execute format('grant execute on function %s to authenticated, service_role',fn.signature);
  end loop;
end $$;

-- The bulk grant above only covers authenticated/service_role; the invite
-- preview must stay executable by anonymous visitors (pre-login invite card).
grant execute on function public.ddtal_invite_preview(uuid) to anon;

comment on column public.ddtal_roles.manage_server is 'Permite editar nome, ícone, descrição e aparência do servidor.';
commit;
