// ==================== SUPABASE SERVER CONFIGURATION ====================
// This file configures the Supabase client for server-side use.
// It uses the service role key which has full admin access to bypass Row Level Security (RLS).
// NEVER expose this file or its keys to the browser - this is for server-side only!

// ==================== IMPORTS ====================
require('dotenv').config();  // Load environment variables from .env file
const { createClient } = require('@supabase/supabase-js');  // Import Supabase client creation function

// ==================== LOAD CREDENTIALS ====================
// Load Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL;  // Supabase project URL (e.g., https://xyz.supabase.co)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;  // Service role key (full admin access)

// ==================== VALIDATE CREDENTIALS ====================
// Validate that required environment variables are set
if (!supabaseUrl || !supabaseServiceKey) {  // Check if either variable is missing
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file!');  // Print error message
    process.exit(1);  // Exit the process with error code 1
}

// ==================== CREATE SUPABASE CLIENT ====================
// Create Supabase client with service role key (full admin access)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {  // Initialize Supabase client
    auth: {  // Authentication configuration
        autoRefreshToken: false,  // Disable auto-refresh for server-side usage (no need for token refresh)
        persistSession: false     // Don't persist session on server (server is stateless)
    }
});

// ==================== EXPORT ====================
module.exports = { supabase };  // Export the configured Supabase client for use in other files
