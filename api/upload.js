import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'gala-uploads';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end('Method Not Allowed');
  }

  const { filename, folder = 'uploads' } = req.body ?? {};
  if (!filename) return res.status(400).json({ error: 'filename required' });

  // Namespace by folder + timestamp so re-uploads never collide and admin
  // can tell logos/PDFs/floor-plan images apart by path alone.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${Date.now()}-${safeName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error) return res.status(500).json({ error: error.message });

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return res.status(200).json({
    signedUrl: data.signedUrl,
    token: data.token,
    path,
    publicUrl: publicData.publicUrl,
  });
}
