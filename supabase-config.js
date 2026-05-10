// supabase-config.js — Server-side Supabase client (uses service role key)
// Never expose this file or its keys to the browser!
// Service role key bypasses RLS policies - use only on server
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Load Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Validate that required environment variables are set
if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file!');
    process.exit(1);
}

// Create Supabase client with service role key (full admin access)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,  // Disable auto-refresh for server-side usage
        persistSession: false     // Don't persist session on server
    }
});

module.exports = { supabase };
