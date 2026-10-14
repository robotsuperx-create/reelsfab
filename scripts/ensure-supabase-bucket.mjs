const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Supabase Storage secrets are missing");

const auth = { apikey: key, Authorization: `Bearer ${key}` };
const list = await fetch(`${base}/storage/v1/bucket`, { headers: auth });
if (!list.ok) throw new Error(`storage list ${list.status}`);
const buckets = await list.json();
if (buckets.some((bucket) => bucket.id === "reelsfab")) {
  console.log(JSON.stringify({ bucketCreated: false, alreadyExists: true }));
  process.exit(0);
}

const response = await fetch(`${base}/storage/v1/bucket`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ id: "reelsfab", name: "reelsfab", public: false, file_size_limit: 52428800 }),
});
if (!response.ok) throw new Error(`bucket create ${response.status}: ${(await response.text()).slice(0, 240)}`);
console.log(JSON.stringify({ bucketCreated: true, private: true, maxBytes: 52428800 }));
