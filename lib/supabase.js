// lib/supabase.js
// Shared Supabase client for all serverless functions.
// Uses the SERVICE ROLE key (full access, bypasses RLS) — this file is
// only ever imported by server-side code in /api, never sent to the browser.

const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

module.exports = { getSupabaseClient };
