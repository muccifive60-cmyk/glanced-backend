import { createClient } from '@supabase/supabase-js';

// Load environment variables from Vite (Frontend)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// validation check
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ Missing Supabase Environment Variables! Check your .env file.');
}

// Export the client for use in React components
export const supabase = createClient(supabaseUrl, supabaseAnonKey);