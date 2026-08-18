async function getJSON(url){const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}
getJSON('/api/auth/status').then(console.log).catch(console.error);
