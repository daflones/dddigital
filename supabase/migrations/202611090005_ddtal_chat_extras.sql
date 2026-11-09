-- Discodigital chat extras: replies, edits, deletes and audio attachments.
begin;

alter table public.ddtal_messages
  add column reply_to uuid references public.ddtal_messages(id) on delete set null,
  add column edited_at timestamptz;
create index ddtal_messages_reply_idx on public.ddtal_messages(reply_to) where reply_to is not null;

-- Replies must reference a message in the same channel; edits may only touch content/edited_at.
create or replace function public.ddtal_message_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.reply_to is not null then
    if not exists(select 1 from public.ddtal_messages p where p.id = new.reply_to and p.channel_id = new.channel_id) then
      raise exception 'A resposta precisa apontar para uma mensagem desta conversa.';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.channel_id is distinct from old.channel_id or new.author_id is distinct from old.author_id
       or new.reply_to is distinct from old.reply_to
       or new.attachment_path is distinct from old.attachment_path
       or new.attachment_name is distinct from old.attachment_name
       or new.attachment_type is distinct from old.attachment_type then
      raise exception 'Somente o conteúdo da mensagem pode ser editado.';
    end if;
  end if;
  return new;
end $$;
create trigger ddtal_messages_guard before insert or update on public.ddtal_messages
  for each row execute function public.ddtal_message_guard();

create policy ddtal_messages_update on public.ddtal_messages for update to authenticated
  using (author_id = (select auth.uid()) and public.ddtal_can_access_channel(channel_id))
  with check (author_id = (select auth.uid()));
-- authors delete their own messages; who can kick members also moderates content
create policy ddtal_messages_delete on public.ddtal_messages for delete to authenticated
  using (author_id = (select auth.uid())
    or exists(select 1 from public.ddtal_channels c where c.id = channel_id and c.server_id is not null
              and public.ddtal_has_perm(c.server_id, (select auth.uid()), 'kick_members')));

grant insert(reply_to) on public.ddtal_messages to authenticated;
grant update(content, edited_at) on public.ddtal_messages to authenticated;
grant delete on public.ddtal_messages to authenticated;

-- audio clips for voice messages
alter table public.ddtal_messages drop constraint ddtal_messages_check1;
alter table public.ddtal_messages add constraint ddtal_messages_attachment_check check (
  (attachment_path is null and attachment_name is null and attachment_type is null) or
  (attachment_path is not null and attachment_name is not null and attachment_type in
    ('image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain',
     'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav')));

update storage.buckets set allowed_mime_types = allowed_mime_types ||
  array['audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav']
where id = 'ddtal-attachments' and not (allowed_mime_types @> array['audio/webm']);

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
