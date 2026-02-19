import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Only create client when configured - avoids "supabaseUrl is required" when using mock data
let _client: SupabaseClient | null = null;
if (supabaseUrl) {
  _client = createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = _client!;
