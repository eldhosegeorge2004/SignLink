// public/supabase-client.js
const supabaseUrl = 'https://ynvykdraupxkhsxxsonb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InludnlrZHJhdXB4a2hzeHhzb25iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMTIyMDUsImV4cCI6MjA4ODg4ODIwNX0.DRdCi6jxts3i9g0vTaRevRcIB4xfEadqxxX_d3DYzvA';
window.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
