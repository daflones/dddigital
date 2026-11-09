-- Discodigital roles + permissions (additive; does not modify SeekerAI/fsociety objects).
begin;

create table public.ddtal_roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.ddtal_servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#b69afb' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position integer not null default 0,
  -- permission flags
  moderate_voice boolean not null default false,    -- mute/unmute/kick/move in voice rooms
  manage_channels boolean not null default false,   -- create channels
  manage_roles boolean not null default false,      -- create/assign/delete roles
  manage_invites boolean not null default false,    -- create/delete invites
  kick_members boolean not null default false,      -- remove members from server
  edit_notes boolean not null default false,        -- edit shared notes
  created_at timestamptz not null default now()
);
create index ddtal_roles_server_idx on public.ddtal_roles(server_id, position);

create table public.ddtal_member_roles (
  server_id uuid not null references public.ddtal_servers(id) on delete cascade,
  user_id uuid not null references public.ddtal_profiles(id) on delete cascade,
  role_id uuid not null references public.ddtal_roles(id) on delete cascade,
  primary key (server_id, user_id, role_id),
  foreign key (server_id, user_id) references public.ddtal_members(server_id, user_id) on delete cascade
);
create index ddtal_member_roles_user_idx on public.ddtal_member_roles(user_id);

-- owners/moderators keep all powers implicitly; roles grant extras to regular members.
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
           else false end)
$$;

create or replace function public.ddtal_can_edit_notes(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.ddtal_channels c where c.id=p_channel and
    (public.ddtal_is_staff(c.server_id)
     or (c.server_id is not null and public.ddtal_has_perm(c.server_id,(select auth.uid()),'edit_notes'))
     or (c.kind='direct' and public.ddtal_can_access_channel(c.id))))
$$;

alter table public.ddtal_roles enable row level security;
alter table public.ddtal_member_roles enable row level security;
create policy ddtal_roles_read on public.ddtal_roles for select to authenticated using (public.ddtal_is_member(server_id));
create policy ddtal_member_roles_read on public.ddtal_member_roles for select to authenticated using (public.ddtal_is_member(server_id));

revoke all on public.ddtal_roles, public.ddtal_member_roles from anon, authenticated;
grant select on public.ddtal_roles, public.ddtal_member_roles to authenticated;
grant all on public.ddtal_roles, public.ddtal_member_roles to service_role;

-- widen channel creation to role-based manage_channels (keeps staff power via has_perm)
drop policy ddtal_channels_create on public.ddtal_channels;
create policy ddtal_channels_create on public.ddtal_channels for insert to authenticated with check (
  kind <> 'direct' and public.ddtal_has_perm(server_id,(select auth.uid()),'manage_channels'));

-- widen invite create RPC to manage_invites
create or replace function public.ddtal_create_invite(p_server uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation uuid;
begin
  if not public.ddtal_has_perm(p_server, auth.uid(), 'manage_invites') then raise exception 'Sem permissão para criar convites.'; end if;
  insert into public.ddtal_invites(server_id,created_by) values(p_server,auth.uid()) returning id into invitation;
  return invitation;
end $$;

drop policy ddtal_invites_read on public.ddtal_invites;
create policy ddtal_invites_read on public.ddtal_invites for select to authenticated
  using (public.ddtal_has_perm(server_id,(select auth.uid()),'manage_invites'));
drop policy ddtal_invites_delete on public.ddtal_invites;
create policy ddtal_invites_delete on public.ddtal_invites for delete to authenticated
  using (public.ddtal_has_perm(server_id,(select auth.uid()),'manage_invites'));

-- role management RPCs (mutations go through functions, not direct table writes)
create or replace function public.ddtal_create_role(p_server uuid, p_name text, p_color text, p_flags jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not public.ddtal_has_perm(p_server, auth.uid(), 'manage_roles') then raise exception 'Sem permissão para criar cargos.'; end if;
  insert into public.ddtal_roles(server_id,name,color,position,
    moderate_voice,manage_channels,manage_roles,manage_invites,kick_members,edit_notes)
  values(p_server, left(trim(p_name),40), coalesce(p_color,'#b69afb'),
    coalesce((select max(position) from public.ddtal_roles where server_id=p_server),0)+1,
    coalesce((p_flags->>'moderate_voice')::boolean,false), coalesce((p_flags->>'manage_channels')::boolean,false),
    coalesce((p_flags->>'manage_roles')::boolean,false), coalesce((p_flags->>'manage_invites')::boolean,false),
    coalesce((p_flags->>'kick_members')::boolean,false), coalesce((p_flags->>'edit_notes')::boolean,false))
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
    edit_notes=coalesce((p_flags->>'edit_notes')::boolean,edit_notes)
  where id=p_role;
end $$;

create or replace function public.ddtal_delete_role(p_role uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select server_id into sid from public.ddtal_roles where id=p_role;
  if sid is null then return; end if;
  if not public.ddtal_has_perm(sid, auth.uid(), 'manage_roles') then raise exception 'Sem permissão para excluir cargos.'; end if;
  delete from public.ddtal_roles where id=p_role;
end $$;

create or replace function public.ddtal_move_role(p_role uuid, p_dir integer) returns void
language plpgsql security definer set search_path = '' as $$
declare rec record; other record;
begin
  select * into rec from public.ddtal_roles where id=p_role;
  if rec.id is null then return; end if;
  if not public.ddtal_has_perm(rec.server_id, auth.uid(), 'manage_roles') then raise exception 'Sem permissão.'; end if;
  if p_dir > 0 then
    select * into other from public.ddtal_roles where server_id=rec.server_id and position > rec.position order by position limit 1;
  else
    select * into other from public.ddtal_roles where server_id=rec.server_id and position < rec.position order by position desc limit 1;
  end if;
  if other.id is null then return; end if;
  update public.ddtal_roles set position=other.position where id=p_role;
  update public.ddtal_roles set position=rec.position where id=other.id;
end $$;

create or replace function public.ddtal_assign_role(p_role uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select server_id into sid from public.ddtal_roles where id=p_role;
  if sid is null then raise exception 'Cargo não encontrado.'; end if;
  if not public.ddtal_has_perm(sid, auth.uid(), 'manage_roles') then raise exception 'Sem permissão para atribuir cargos.'; end if;
  if not exists(select 1 from public.ddtal_members where server_id=sid and user_id=p_user) then raise exception 'Usuário não é membro deste servidor.'; end if;
  insert into public.ddtal_member_roles(server_id,user_id,role_id) values(sid,p_user,p_role) on conflict do nothing;
end $$;

create or replace function public.ddtal_unassign_role(p_role uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select server_id into sid from public.ddtal_roles where id=p_role;
  if sid is null then return; end if;
  if not public.ddtal_has_perm(sid, auth.uid(), 'manage_roles') then raise exception 'Sem permissão para remover cargos.'; end if;
  delete from public.ddtal_member_roles where role_id=p_role and user_id=p_user;
end $$;

-- kick member from the server (distinct from kicking out of a voice room): needs kick_members perm.
create or replace function public.ddtal_remove_member(p_server uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.ddtal_has_perm(p_server, auth.uid(), 'kick_members') then raise exception 'Sem permissão para remover membros.'; end if;
  if exists(select 1 from public.ddtal_servers where id=p_server and owner_id=p_user) then raise exception 'O dono não pode ser removido.'; end if;
  delete from public.ddtal_members where server_id=p_server and user_id=p_user;
end $$;

-- check whether the caller may moderate a voice channel (staff, moderate_voice role, or DM participant)
create or replace function public.ddtal_can_moderate_voice(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.ddtal_channels c where c.id=p_channel and
    ((c.server_id is not null and public.ddtal_has_perm(c.server_id,(select auth.uid()),'moderate_voice'))
     or (c.kind='direct' and public.ddtal_can_access_channel(c.id))))
$$;

-- Realtime + grants for the new objects.
do $$
declare fn record; tbl text;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'ddtal_%'
  loop
    execute format('revoke all on function %s from public, anon',fn.signature);
    execute format('grant execute on function %s to authenticated, service_role',fn.signature);
  end loop;
  foreach tbl in array array['ddtal_roles','ddtal_member_roles'] loop
    execute format('alter publication supabase_realtime add table public.%I',tbl);
  end loop;
end $$;

comment on table public.ddtal_roles is 'Discodigital (ddtal): server roles with per-role permissions.';
comment on table public.ddtal_member_roles is 'Discodigital (ddtal): member role assignments.';
commit;
