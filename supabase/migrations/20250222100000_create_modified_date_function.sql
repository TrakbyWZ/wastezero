-- Function used by audit triggers to set modified_date on UPDATE
create or replace function public.set_modified_date()
returns trigger
language plpgsql
as $$
begin
  new.modified_date = now();
  return new;
end;
$$;
