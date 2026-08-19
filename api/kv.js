import { createClient } from '@supabase/supabase-js';

// Service-role key — set in Vercel env vars, never exposed to the browser.
// RLS stays ON on the kv table with zero policies; this key bypasses RLS
// entirely, which is the intended access path (the browser never talks
// to Supabase directly for kv reads/writes).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key required' });

    const { data, error } = await supabase
      .from('kv')
      .select('value, version')
      .eq('key', key)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });

    return res.status(200).json({ value: data.value, version: data.version });
  }

  if (req.method === 'POST') {
    const { key, value, expectedVersion } = req.body ?? {};
    if (!key) return res.status(400).json({ error: 'key required' });

    // Optimistic concurrency: read current version, compare, then write.
    // Not perfectly race-free without a DB-level transaction/RPC, but for
    // this app's write pattern (occasional form saves, not high-frequency
    // concurrent writes to the same key) it's enough to catch the real
    // failure mode: two sponsors editing the same record at once.
    const { data: existing, error: readErr } = await supabase
      .from('kv')
      .select('version')
      .eq('key', key)
      .maybeSingle();

    if (readErr) return res.status(500).json({ error: readErr.message });

    if (existing && expectedVersion != null && existing.version !== expectedVersion) {
      return res.status(409).json({ error: 'version conflict' });
    }

    const nextVersion = existing ? existing.version + 1 : 1;

    const { error: writeErr } = await supabase
      .from('kv')
      .upsert({ key, value, version: nextVersion, updated_at: new Date().toISOString() });

    if (writeErr) return res.status(500).json({ error: writeErr.message });

    return res.status(200).json({ version: nextVersion });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
}
