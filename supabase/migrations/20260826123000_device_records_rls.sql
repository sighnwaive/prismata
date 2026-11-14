alter table public.device_records enable row level security;

create policy device_records_select_owner on public.device_records
  for select
  using (auth.uid() = user_id);

create policy device_records_insert_owner on public.device_records
  for insert
  with check (auth.uid() = user_id);

create policy device_records_update_owner on public.device_records
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
