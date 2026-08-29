-- Reordering: renumber a diary's pages from an ordered list of scans.
--
-- Page numbers are dense -- a two-page spread occupies N and N+1 -- and the
-- primary key is (diary_id, page_id). So a reorder is not "swap two numbers":
-- it is "rewrite every page_id from the new order", and doing that one UPDATE
-- at a time from the application would transiently collide on the primary key
-- and could leave the diary half-renumbered if the request died midway.
--
-- One function, one transaction: it either all lands or none of it does.
--
-- Safe to re-run.

create or replace function public.reorder_diary_pages(p_diary_id smallint, p_keys text[])
returns void
language plpgsql
-- security invoker (the default) on purpose: the app calls this with the
-- service-role key, which already bypasses RLS, so there is no reason to give
-- the function rights of its own.
set search_path = ''
as $$
declare
  k       text;
  cnt     smallint;
  next_id integer := 1;
  total   integer;
begin
  select count(*) into total from public.pages where diary_id = p_diary_id;

  if total <> coalesce(array_length(p_keys, 1), 0) then
    raise exception 'reorder list has % entries but diary % has % pages',
      coalesce(array_length(p_keys, 1), 0), p_diary_id, total;
  end if;

  -- Park every row outside the range about to be handed out. Without this,
  -- assigning a final number to one scan could collide with a scan that has not
  -- moved yet. Negating keeps the values distinct from each other and from
  -- everything being assigned; the column has no positivity constraint.
  update public.pages set page_id = -page_id where diary_id = p_diary_id;

  foreach k in array p_keys loop
    -- Scans are identified by storage_key, never by page_id: page_id is the
    -- column being rewritten, so it cannot also be the handle.
    select page_count into cnt
      from public.pages
     where diary_id = p_diary_id and storage_key = k;

    if cnt is null then
      raise exception 'unknown storage_key % for diary %', k, p_diary_id;
    end if;

    update public.pages
       set page_id = next_id
     where diary_id = p_diary_id and storage_key = k;

    next_id := next_id + cnt;
  end loop;

  -- A duplicate entry in the list would leave some other scan still parked.
  if exists (select 1 from public.pages where diary_id = p_diary_id and page_id < 0) then
    raise exception 'reorder list did not cover every page of diary %', p_diary_id;
  end if;
end;
$$;

-- PostgREST exposes functions to every role by default, and this one rewrites
-- the whole diary's ordering. Only the server-side client should reach it.
revoke execute on function public.reorder_diary_pages(smallint, text[]) from public;
revoke execute on function public.reorder_diary_pages(smallint, text[]) from anon;
revoke execute on function public.reorder_diary_pages(smallint, text[]) from authenticated;
grant  execute on function public.reorder_diary_pages(smallint, text[]) to service_role;
