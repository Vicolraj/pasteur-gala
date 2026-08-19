// Drop-in replacement for the prototype's key-value storage layer.
// Same two-argument call signature the client's app already uses —
// nothing in App.jsx has to change beyond the import.
//
// Persistence: Supabase, via the /api/kv serverless function (so the
// service-role key never reaches the browser). Writes are optimistic-
// concurrency checked: if two people save the same key at once, the
// second write is rejected with a conflict instead of silently
// clobbering the first.

const versionCache = new Map();

export async function stGet(key) {
  const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`);
  if (res.status === 404) {
    versionCache.delete(key);
    return null;
  }
  if (!res.ok) {
    throw new Error(`stGet(${key}) failed: ${res.status}`);
  }
  const { value, version } = await res.json();
  versionCache.set(key, version);
  return value;
}

export async function stSet(key, value) {
  const expectedVersion = versionCache.get(key) ?? null;

  const res = await fetch('/api/kv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, expectedVersion }),
  });

  if (res.status === 409) {
    // Someone else wrote this key since our last read. Re-fetch so the
    // caller has the latest value; the app's own re-render/re-save flow
    // handles the rest. We surface a typed error so callers *can*
    // special-case it, but default behavior degrades gracefully.
    const latest = await stGet(key);
    const err = new Error(`stSet(${key}) conflict — value changed underneath`);
    err.code = 'CONFLICT';
    err.latestValue = latest;
    throw err;
  }

  if (!res.ok) {
    throw new Error(`stSet(${key}) failed: ${res.status}`);
  }

  const { version } = await res.json();
  versionCache.set(key, version);
  return true;
}

// File uploads (logos, PDFs, floor-plan images) go straight to Supabase
// Storage via a short-lived signed URL — the file bytes never pass
// through our serverless function, so there's no practical size ceiling
// to enforce app-side beyond what the bucket allows.
//
// Usage: const { publicUrl } = await stUploadFile(file, 'sponsor-logos');
export async function stUploadFile(file, folder = 'uploads') {
  const signRes = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      folder,
    }),
  });

  if (!signRes.ok) {
    throw new Error(`Could not get upload URL: ${signRes.status}`);
  }

  const { signedUrl, path, publicUrl, token } = await signRes.json();

  const uploadRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  // Supabase's signed-upload PUT accepts the token embedded in the URL;
  // kept here in case the API route ever switches to header-based auth.
  void token;

  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${uploadRes.status}`);
  }

  return { path, publicUrl };
}
