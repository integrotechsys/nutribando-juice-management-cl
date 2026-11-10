-- Run this if you can log in to Supabase but the app sends you back to the login page.
-- It creates the missing profile for any login created BEFORE schema.sql was run.
-- The oldest login becomes Admin, the rest become Staff.
insert into public.profiles (id, email, full_name, role)
select u.id, u.email, split_part(u.email, '@', 1),
       case when not exists (select 1 from public.profiles where role = 'admin')
             and u.id = (select id from auth.users order by created_at limit 1)
            then 'admin' else 'staff' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

select email, role, active from public.profiles order by created_at;
