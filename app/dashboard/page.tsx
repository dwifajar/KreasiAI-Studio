import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import Studio from '@/components/Studio';
export const dynamic='force-dynamic';
export default async function Dashboard(){const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect('/');return <Studio email={user.email||''}/>}
