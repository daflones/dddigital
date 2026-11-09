begin;

-- Discodigital is isolated from fsociety and the other applications in this project.
create table public.ddtal_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,32}$'),
  created_at timestamptz not null default now()
);
create table public.ddtal_servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  description text not null default '' check (char_length(description) <= 240),
  owner_id uuid not null references public.ddtal_profiles(id),
  created_at timestamptz not null default now()
);
create table public.ddtal_members (
  server_id uuid not null references public.ddtal_servers(id) on delete cascade,
  user_id uuid not null references public.ddtal_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','moderator','member')),
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index ddtal_members_user_idx on public.ddtal_members(user_id);
create table public.ddtal_channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references public.ddtal_servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  topic text not null default '' check (char_length(topic) <= 240),
  kind text not null check (kind in ('text','voice','direct')),
  direct_key text unique,
  created_at timestamptz not null default now(),
  check ((kind = 'direct' and server_id is null and direct_key is not null)
    or (kind <> 'direct' and server_id is not null and direct_key is null))
);
create index ddtal_channels_server_idx on public.ddtal_channels(server_id);
create table public.ddtal_channel_members (
  channel_id uuid not null references public.ddtal_channels(id) on delete cascade,
  user_id uuid not null references public.ddtal_profiles(id) on delete cascade,
  primary key(channel_id, user_id)
);
create index ddtal_channel_members_user_idx on public.ddtal_channel_members(user_id);
create table public.ddtal_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.ddtal_channels(id) on delete cascade,
  author_id uuid not null references public.ddtal_profiles(id),
  content text not null default '' check (char_length(content) <= 6000),
  attachment_path text,
  attachment_name text check (char_length(attachment_name) <= 255),
  attachment_type text,
  created_at timestamptz not null default now(),
  check (length(trim(content)) > 0 or attachment_path is not null),
  check ((attachment_path is null and attachment_name is null and attachment_type is null) or
    (attachment_path is not null and attachment_name is not null and attachment_type in
      ('image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain')))
);
create index ddtal_messages_channel_time_idx on public.ddtal_messages(channel_id, created_at desc, id);
create table public.ddtal_friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.ddtal_profiles(id) on delete cascade,
  recipient_id uuid not null references public.ddtal_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);
create unique index ddtal_friendships_pair_idx on public.ddtal_friendships
  (least(requester_id, recipient_id), greatest(requester_id, recipient_id));
create index ddtal_friendships_recipient_idx on public.ddtal_friendships(recipient_id);
create table public.ddtal_invites (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.ddtal_servers(id) on delete cascade,
  created_by uuid not null references public.ddtal_profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 100 check (max_uses between 1 and 1000),
  uses integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now()
);
create table public.ddtal_notes (
  channel_id uuid primary key references public.ddtal_channels(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 30000),
  updated_by uuid not null references public.ddtal_profiles(id),
  updated_at timestamptz not null default now()
);

create function public.ddtal_is_member(p_server uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.ddtal_members where server_id=p_server and user_id=(select auth.uid())) $$;
create function public.ddtal_is_staff(p_server uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.ddtal_members where server_id=p_server and user_id=(select auth.uid()) and role in ('owner','moderator')) $$;
create function public.ddtal_can_access_channel(p_channel uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.ddtal_channels c where c.id=p_channel and
    (public.ddtal_is_member(c.server_id) or exists(
      select 1 from public.ddtal_channel_members m where m.channel_id=c.id and m.user_id=(select auth.uid())
    )))
$$;
create function public.ddtal_can_edit_notes(p_channel uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.ddtal_channels c where c.id=p_channel and
  (public.ddtal_is_staff(c.server_id) or (c.kind='direct' and public.ddtal_can_access_channel(c.id)))) $$;

alter table public.ddtal_profiles enable row level security;
alter table public.ddtal_servers enable row level security;
alter table public.ddtal_members enable row level security;
alter table public.ddtal_channels enable row level security;
alter table public.ddtal_channel_members enable row level security;
alter table public.ddtal_messages enable row level security;
alter table public.ddtal_friendships enable row level security;
alter table public.ddtal_invites enable row level security;
alter table public.ddtal_notes enable row level security;

create policy ddtal_profiles_read on public.ddtal_profiles for select to authenticated using (true);
create policy ddtal_profiles_update on public.ddtal_profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy ddtal_servers_read on public.ddtal_servers for select to authenticated using (public.ddtal_is_member(id));
create policy ddtal_members_read on public.ddtal_members for select to authenticated using (public.ddtal_is_member(server_id));
create policy ddtal_channels_read on public.ddtal_channels for select to authenticated using (public.ddtal_can_access_channel(id));
create policy ddtal_channels_create on public.ddtal_channels for insert to authenticated with check (kind <> 'direct' and public.ddtal_is_staff(server_id));
create policy ddtal_channel_members_read on public.ddtal_channel_members for select to authenticated using (public.ddtal_can_access_channel(channel_id));
create policy ddtal_messages_read on public.ddtal_messages for select to authenticated using (public.ddtal_can_access_channel(channel_id));
create policy ddtal_messages_create on public.ddtal_messages for insert to authenticated with check (
  author_id=(select auth.uid()) and public.ddtal_can_access_channel(channel_id)
  and (attachment_path is null or (
    split_part(attachment_path,'/',1)=channel_id::text
    and split_part(attachment_path,'/',2)=(select auth.uid())::text
  ))
);
create policy ddtal_friendships_read on public.ddtal_friendships for select to authenticated using ((select auth.uid()) in (requester_id,recipient_id));
create policy ddtal_friendships_delete on public.ddtal_friendships for delete to authenticated using ((select auth.uid()) in (requester_id,recipient_id));
create policy ddtal_invites_read on public.ddtal_invites for select to authenticated using (public.ddtal_is_staff(server_id));
create policy ddtal_invites_delete on public.ddtal_invites for delete to authenticated using (public.ddtal_is_staff(server_id));
create policy ddtal_notes_read on public.ddtal_notes for select to authenticated using (public.ddtal_can_access_channel(channel_id));
create policy ddtal_notes_create on public.ddtal_notes for insert to authenticated with check (public.ddtal_can_edit_notes(channel_id) and updated_by=(select auth.uid()));
create policy ddtal_notes_update on public.ddtal_notes for update to authenticated using (public.ddtal_can_edit_notes(channel_id)) with check (public.ddtal_can_edit_notes(channel_id) and updated_by=(select auth.uid()));

create function public.ddtal_ensure_profile() returns public.ddtal_profiles
language plpgsql security definer set search_path = '' as $$
declare result public.ddtal_profiles; name text;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar.'; end if;
  select left(coalesce(nullif(trim(raw_user_meta_data->>'display_name'),''),nullif(trim(raw_user_meta_data->>'full_name'),''),'Builder'),60)
    into name from auth.users where id=auth.uid();
  if char_length(name)<2 then name := 'Builder'; end if;
  insert into public.ddtal_profiles(id,display_name,handle)
    values(auth.uid(),name,replace(auth.uid()::text,'-',''))
    on conflict(id) do nothing;
  select * into result from public.ddtal_profiles where id=auth.uid();
  return result;
end $$;

create function public.ddtal_create_server(p_name text, p_description text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare server uuid;
begin
  perform public.ddtal_ensure_profile();
  if (select count(*) from public.ddtal_servers where owner_id=auth.uid()) >= 20 then raise exception 'Limite de servidores atingido.'; end if;
  insert into public.ddtal_servers(name,description,owner_id) values(trim(p_name),trim(p_description),auth.uid()) returning id into server;
  insert into public.ddtal_members(server_id,user_id,role) values(server,auth.uid(),'owner');
  insert into public.ddtal_channels(server_id,name,kind,topic) values
    (server,'boas-vindas','text','Sua comunidade começa aqui.'),
    (server,'avisos','text','Novidades e próximos encontros.'),
    (server,'geral','text','Ideias, descobertas e boas conversas.'),
    (server,'tira-dúvidas','text','Nenhuma dúvida fica para trás.'),
    (server,'projetos','text','Compartilhe o que você está construindo.'),
    (server,'Sala de aula','voice','Um espaço para aprender fazendo. Juntos.'),
    (server,'Coworking','voice','Vamos construir juntos.');
  return server;
end $$;

create function public.ddtal_create_invite(p_server uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation uuid;
begin
  if not public.ddtal_is_staff(p_server) then raise exception 'Somente a equipe pode criar convites.'; end if;
  insert into public.ddtal_invites(server_id,created_by) values(p_server,auth.uid()) returning id into invitation;
  return invitation;
end $$;

create function public.ddtal_join_invite(p_invite uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation public.ddtal_invites;
begin
  perform public.ddtal_ensure_profile();
  select * into invitation from public.ddtal_invites where id=p_invite for update;
  if not found then raise exception 'Convite inválido.'; end if;
  if public.ddtal_is_member(invitation.server_id) then return invitation.server_id; end if;
  if invitation.expires_at < now() or invitation.uses >= invitation.max_uses then raise exception 'Este convite expirou. Peça um novo link.'; end if;
  insert into public.ddtal_members(server_id,user_id) values(invitation.server_id,auth.uid());
  update public.ddtal_invites set uses=uses+1 where id=p_invite;
  return invitation.server_id;
end $$;

create function public.ddtal_request_friend(p_handle text) returns void
language plpgsql security definer set search_path = '' as $$
declare peer uuid;
begin
  perform public.ddtal_ensure_profile();
  select id into peer from public.ddtal_profiles where handle=lower(trim(p_handle));
  if peer is null then raise exception 'Usuário não encontrado. Confira o identificador.'; end if;
  if peer=auth.uid() then raise exception 'Esse é o seu identificador.'; end if;
  if (select count(*) from public.ddtal_friendships where requester_id=auth.uid() and status='pending') >= 50 then raise exception 'Limite de solicitações pendentes atingido.'; end if;
  insert into public.ddtal_friendships(requester_id,recipient_id) values(auth.uid(),peer)
    on conflict do nothing;
end $$;
create function public.ddtal_accept_friend(p_friendship uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.ddtal_friendships set status='accepted' where id=p_friendship and recipient_id=auth.uid() and status='pending';
  if not found then raise exception 'Solicitação não encontrada.'; end if;
end $$;
create function public.ddtal_open_dm(p_peer uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare channel uuid; pair text;
begin
  if not exists(select 1 from public.ddtal_friendships where status='accepted' and
    ((requester_id=auth.uid() and recipient_id=p_peer) or (recipient_id=auth.uid() and requester_id=p_peer))) then
    raise exception 'Adicione e aceite a amizade antes de conversar.';
  end if;
  pair := least(auth.uid(),p_peer)::text || ':' || greatest(auth.uid(),p_peer)::text;
  insert into public.ddtal_channels(name,kind,direct_key,topic) values('Conversa direta','direct',pair,'Só vocês. Uma boa conversa.')
    on conflict(direct_key) do update set direct_key=excluded.direct_key returning id into channel;
  insert into public.ddtal_channel_members(channel_id,user_id) values(channel,auth.uid()),(channel,p_peer) on conflict do nothing;
  return channel;
end $$;

-- Limit grants explicitly, including installations with permissive default privileges.
revoke all on public.ddtal_profiles,public.ddtal_servers,public.ddtal_members,public.ddtal_channels,
  public.ddtal_channel_members,public.ddtal_messages,public.ddtal_friendships,public.ddtal_invites,public.ddtal_notes from anon,authenticated;
grant select on public.ddtal_profiles,public.ddtal_servers,public.ddtal_members,public.ddtal_channels,
  public.ddtal_channel_members,public.ddtal_messages,public.ddtal_friendships,public.ddtal_invites,public.ddtal_notes to authenticated;
grant update(display_name,handle) on public.ddtal_profiles to authenticated;
grant insert(server_id,name,topic,kind) on public.ddtal_channels to authenticated;
grant insert(id,channel_id,author_id,content,attachment_path,attachment_name,attachment_type) on public.ddtal_messages to authenticated;
grant insert,update on public.ddtal_notes to authenticated;
grant delete on public.ddtal_friendships,public.ddtal_invites to authenticated;
grant all on public.ddtal_profiles,public.ddtal_servers,public.ddtal_members,public.ddtal_channels,
  public.ddtal_channel_members,public.ddtal_messages,public.ddtal_friendships,public.ddtal_invites,public.ddtal_notes to service_role;

do $$
declare fn record; tbl text;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'ddtal_%'
  loop
    execute format('revoke all on function %s from public, anon',fn.signature);
    execute format('grant execute on function %s to authenticated, service_role',fn.signature);
  end loop;
  foreach tbl in array array['ddtal_messages','ddtal_notes','ddtal_members','ddtal_channels','ddtal_friendships'] loop
    execute format('alter publication supabase_realtime add table public.%I',tbl);
  end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ddtal-attachments','ddtal-attachments',false,20971520,
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain']);

-- UUID conversion is guarded to avoid malformed paths breaking policies.
create function public.ddtal_storage_channel(path text) returns uuid
language plpgsql immutable set search_path='' as $$
begin return split_part(path,'/',1)::uuid;
exception when invalid_text_representation then return null;
end $$;
revoke all on function public.ddtal_storage_channel(text) from public,anon;
grant execute on function public.ddtal_storage_channel(text) to authenticated,service_role;
create policy ddtal_files_read on storage.objects for select to authenticated
using(bucket_id='ddtal-attachments' and public.ddtal_can_access_channel(public.ddtal_storage_channel(name)));
create policy ddtal_files_create on storage.objects for insert to authenticated
with check(bucket_id='ddtal-attachments' and (storage.foldername(name))[2]=(select auth.uid())::text
  and public.ddtal_can_access_channel(public.ddtal_storage_channel(name)));
create policy ddtal_files_delete on storage.objects for delete to authenticated
using(bucket_id='ddtal-attachments' and (storage.foldername(name))[2]=(select auth.uid())::text);

comment on table public.ddtal_profiles is 'Discodigital (ddtal): public profile, no email or fsociety data.';
comment on table public.ddtal_servers is 'Discodigital (ddtal): community servers.';
comment on table public.ddtal_members is 'Discodigital (ddtal): server membership and roles.';
comment on table public.ddtal_channels is 'Discodigital (ddtal): text, voice and direct channels.';
comment on table public.ddtal_channel_members is 'Discodigital (ddtal): direct conversation membership.';
comment on table public.ddtal_messages is 'Discodigital (ddtal): messages and private attachment references.';
comment on table public.ddtal_friendships is 'Discodigital (ddtal): friendship requests.';
comment on table public.ddtal_invites is 'Discodigital (ddtal): expiring server invites.';
comment on table public.ddtal_notes is 'Discodigital (ddtal): shared lesson notes.';
commit;
