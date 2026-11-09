-- Real PostgreSQL/RLS integration checks. All fixtures and mutations roll back.
begin;
create function pg_temp.ddtal_assert(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;

insert into auth.users(id,email,raw_user_meta_data,aud,role) values
  ('dd000000-0000-4000-8000-000000000001','ddtal-rls-owner@example.invalid','{"display_name":"Owner test"}','authenticated','authenticated'),
  ('dd000000-0000-4000-8000-000000000002','ddtal-rls-member@example.invalid','{"display_name":"Member test"}','authenticated','authenticated'),
  ('dd000000-0000-4000-8000-000000000003','ddtal-rls-outsider@example.invalid','{"display_name":"Outsider test"}','authenticated','authenticated');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.ddtal_ensure_profile();
select set_config('ddtal.test.server',public.ddtal_create_server('Integration test','Ephemeral test')::text,true);
select pg_temp.ddtal_assert((select count(*)=7 from public.ddtal_channels where server_id=current_setting('ddtal.test.server')::uuid),'server seeds channels');
select set_config('ddtal.test.channel',(select id::text from public.ddtal_channels where server_id=current_setting('ddtal.test.server')::uuid and kind='voice' limit 1),true);
select set_config('ddtal.test.invite',public.ddtal_create_invite(current_setting('ddtal.test.server')::uuid)::text,true);
insert into public.ddtal_notes(channel_id,content,updated_by) values(current_setting('ddtal.test.channel')::uuid,'Shared lesson notes',auth.uid());

select set_config('request.jwt.claims','{"sub":"dd000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.ddtal_ensure_profile();
select pg_temp.ddtal_assert(not public.ddtal_can_access_channel(current_setting('ddtal.test.channel')::uuid),'non-member cannot read channel');
select pg_temp.ddtal_assert((select count(*)=0 from public.ddtal_channels where server_id=current_setting('ddtal.test.server')::uuid),'RLS hides channels');
select pg_temp.ddtal_assert((select count(*)=0 from public.ddtal_invites where server_id=current_setting('ddtal.test.server')::uuid),'RLS hides invitation secrets');
select public.ddtal_join_invite(current_setting('ddtal.test.invite')::uuid);
select public.ddtal_join_invite(current_setting('ddtal.test.invite')::uuid);
select pg_temp.ddtal_assert(public.ddtal_can_access_channel(current_setting('ddtal.test.channel')::uuid),'invited member gets access');
select pg_temp.ddtal_assert((select count(*)=1 from public.ddtal_notes where channel_id=current_setting('ddtal.test.channel')::uuid),'member reads lesson notes');
select pg_temp.ddtal_assert(not public.ddtal_can_edit_notes(current_setting('ddtal.test.channel')::uuid),'member cannot edit lesson notes');
insert into public.ddtal_messages(channel_id,author_id,content) values(current_setting('ddtal.test.channel')::uuid,auth.uid(),'A legitimate message');

do $$ begin
  begin
    insert into public.ddtal_messages(channel_id,author_id,content) values(current_setting('ddtal.test.channel')::uuid,'dd000000-0000-4000-8000-000000000001','Spoof');
    raise exception 'ASSERTION FAILED: author spoof accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ddtal_create_invite(current_setting('ddtal.test.server')::uuid);
    raise exception 'ASSERTION FAILED: member minted invite';
  exception when raise_exception then
    if sqlerrm like 'ASSERTION FAILED:%' then raise; end if;
  end;
  begin
    insert into public.ddtal_messages(channel_id,author_id,content,attachment_path,attachment_name,attachment_type)
      values(current_setting('ddtal.test.channel')::uuid,auth.uid(),'Forged file',
      current_setting('ddtal.test.channel') || '/dd000000-0000-4000-8000-000000000001/file','file.png','image/png');
    raise exception 'ASSERTION FAILED: attachment owner spoof accepted';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims','{"sub":"dd000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.ddtal_ensure_profile();
select pg_temp.ddtal_assert((select count(*)=0 from public.ddtal_messages where channel_id=current_setting('ddtal.test.channel')::uuid),'outsider cannot read messages');
select pg_temp.ddtal_assert((select count(*)=0 from public.ddtal_notes where channel_id=current_setting('ddtal.test.channel')::uuid),'outsider cannot read notes');
do $$ begin
  begin
    insert into public.ddtal_messages(channel_id,author_id,content) values(current_setting('ddtal.test.channel')::uuid,auth.uid(),'Intrusion');
    raise exception 'ASSERTION FAILED: outsider posted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ddtal_open_dm('dd000000-0000-4000-8000-000000000001');
    raise exception 'ASSERTION FAILED: unaccepted friend opened DM';
  exception when raise_exception then
    if sqlerrm like 'ASSERTION FAILED:%' then raise; end if;
  end;
end $$;
select public.ddtal_request_friend((select handle from public.ddtal_profiles where id='dd000000-0000-4000-8000-000000000001'));
select set_config('ddtal.test.friend',(select id::text from public.ddtal_friendships where requester_id=auth.uid() and recipient_id='dd000000-0000-4000-8000-000000000001'),true);
do $$ begin
  begin
    perform public.ddtal_accept_friend(current_setting('ddtal.test.friend')::uuid);
    raise exception 'ASSERTION FAILED: requester self-accepted';
  exception when raise_exception then
    if sqlerrm like 'ASSERTION FAILED:%' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims','{"sub":"dd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.ddtal_accept_friend(current_setting('ddtal.test.friend')::uuid);
select set_config('ddtal.test.dm',public.ddtal_open_dm('dd000000-0000-4000-8000-000000000003')::text,true);
select pg_temp.ddtal_assert(public.ddtal_can_access_channel(current_setting('ddtal.test.dm')::uuid),'accepted friend can access DM');
select pg_temp.ddtal_assert((select uses=1 from public.ddtal_invites where id=current_setting('ddtal.test.invite')::uuid),'repeated invite join consumes one use');
select set_config('request.jwt.claims','{"sub":"dd000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.ddtal_assert(not public.ddtal_can_access_channel(current_setting('ddtal.test.dm')::uuid),'server member cannot read others DM');
select pg_temp.ddtal_assert(public.ddtal_storage_channel('malformed/path') is null,'malformed storage path safely rejected');
reset role;
select 'PASS: membership, invites, role restrictions, author spoofing, attachment scope, private DMs and RLS' as result;
rollback;
