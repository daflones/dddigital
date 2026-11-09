-- Discodigital (ddtal): allow DMs between members of the same server,
-- not only between accepted friends. Strangers still cannot open DMs.
create or replace function public.ddtal_open_dm(p_peer uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare channel uuid; pair text;
begin
  if p_peer=auth.uid() then raise exception 'Você não pode conversar consigo mesmo.'; end if;
  if not exists(select 1 from public.ddtal_profiles where id=p_peer) then
    raise exception 'Usuário não encontrado.';
  end if;
  if not exists(select 1 from public.ddtal_friendships where status='accepted' and
    ((requester_id=auth.uid() and recipient_id=p_peer) or (recipient_id=auth.uid() and requester_id=p_peer)))
     and not exists(select 1 from public.ddtal_members mine
        join public.ddtal_members theirs on theirs.server_id=mine.server_id and theirs.user_id=p_peer
        where mine.user_id=auth.uid()) then
    raise exception 'Adicione e aceite a amizade antes de conversar.';
  end if;
  pair := least(auth.uid(),p_peer)::text || ':' || greatest(auth.uid(),p_peer)::text;
  insert into public.ddtal_channels(name,kind,direct_key,topic) values('Conversa direta','direct',pair,'Só vocês. Uma boa conversa.')
    on conflict(direct_key) do update set direct_key=excluded.direct_key returning id into channel;
  insert into public.ddtal_channel_members(channel_id,user_id) values(channel,auth.uid()),(channel,p_peer) on conflict do nothing;
  return channel;
end $$;
