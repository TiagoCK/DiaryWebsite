-- Removing a page, without leaving a hole in the numbering.
--
-- Page numbers are dense: a scan occupies page_id .. page_id + page_count - 1,
-- and the reader's "page N of M" counts on there being no gaps. Deleting a row
-- on its own leaves one, and nothing in the app can close it afterwards -- the
-- Order tab swaps scans, it does not renumber around a missing one.
--
-- So the delete and the renumber have to be one transaction. Split across two
-- statements from the application, a failure between them would leave the diary
-- permanently gappy with no way back.
--
-- The renumbering itself is reorder_diary_pages from 0005: after the delete,
-- the surviving keys in page order ARE the new order, so there is no second
-- implementation of dense numbering to keep in step with the first.
--
-- Requires 0005_reorder.sql.
--
-- Safe to re-run.

create or replace function public.delete_diary_page(p_diary_id smallint, p_storage_key text)
returns integer
language plpgsql
-- security invoker (the default), same reasoning as 0005: the app calls this
-- with the service-role key, which already bypasses RLS.
set search_path = ''
as $$
declare
  keys      text[];
  remaining integer;
begin
  delete from public.pages
   where diary_id = p_diary_id and storage_key = p_storage_key;

  -- Identified by storage_key, not page_id: page_id is about to be rewritten
  -- for every surviving row, so it cannot also be the handle.
  if not found then
    raise exception 'no page with storage_key % in diary %', p_storage_key, p_diary_id;
  end if;

  select array_agg(storage_key order by page_id)
    into keys
    from public.pages
   where diary_id = p_diary_id;

  -- Removing the only page leaves nothing to renumber, and array_agg returns
  -- null rather than an empty array for no rows.
  if keys is null then
    return 0;
  end if;

  perform public.reorder_diary_pages(p_diary_id, keys);

  select coalesce(max(page_id + page_count - 1), 0)
    into remaining
    from public.pages
   where diary_id = p_diary_id;

  return remaining;
end;
$$;

-- PostgREST exposes functions to every role by default, and this one deletes
-- diary pages. Only the server-side client should reach it.
revoke execute on function public.delete_diary_page(smallint, text) from public;
revoke execute on function public.delete_diary_page(smallint, text) from anon;
revoke execute on function public.delete_diary_page(smallint, text) from authenticated;
grant  execute on function public.delete_diary_page(smallint, text) to service_role;
