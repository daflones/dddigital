-- Discodigital: per-server nicknames + moderator promotion (additive).
begin;

alter table public.ddtal_members
  add column nickname text check (nickname is null or char_length(nickname) between 1 and 40);
alter table public.ddtal_roles
  add column manage_nicknames boolean not null default false;

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
           else false end)
$$;

-- Everyone can set their own nickname; changing someone else's needs manage_nicknames.
create or replace function public.ddtal_set_nickname(p_server uuid, p_user uuid, p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
declare clean text;
begin
  clean := nullif(left(trim(p_nickname),40),'');
  if not exists(select 1 from public.ddtal_members where server_id=p_server and user_id=p_user) then
    raise exception 'Usuário não é membro deste servidor.'; end if;
  if p_user <> auth.uid() and not public.ddtal_has_perm(p_server, auth.uid(), 'manage_nicknames') then
    raise exception 'Sem permissão para alterar apelidos.'; end if;
  if p_user = auth.uid() and not exists(select 1 from public.ddtal_members where server_id=p_server and user_id=auth.uid()) then
    raise exception 'Você não é membro deste servidor.'; end if;
  update public.ddtal_members set nickname=clean where server_id=p_server and user_id=p_user;
end $$;

-- Promote/demote between member and moderator; owner cannot be changed.
create or replace function public.ddtal_set_member_role(p_server uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_role not in ('member','moderator') then raise exception 'Papel inválido.'; end if;
  if not public.ddtal_has_perm(p_server, auth.uid(), 'manage_roles') then raise exception 'Sem permissão para alterar papéis.'; end if;
  if exists(select 1 from public.ddtal_servers where id=p_server and owner_id=p_user) then raise exception 'O dono não pode ser alterado.'; end if;
  update public.ddtal_members set role=p_role where server_id=p_server and user_id=p_user;
  if not found then raise exception 'Usuário não é membro deste servidor.'; end if;
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

commit;
