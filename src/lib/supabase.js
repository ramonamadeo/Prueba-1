import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
  ''
).trim();

const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey);

const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

async function pingSupabase() {
  if (!hasSupabaseConfig) {
    throw new Error('Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_PUBLISHABLE_KEY');
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: {
      apikey: supabasePublishableKey,
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json();
}

function getSupabaseProjectRef() {
  try {
    return new URL(supabaseUrl).hostname.replace('.supabase.co', '');
  } catch {
    return '';
  }
}

export {
  getSupabaseProjectRef,
  hasSupabaseConfig,
  pingSupabase,
  supabase,
  supabasePublishableKey,
  supabaseUrl,
};
