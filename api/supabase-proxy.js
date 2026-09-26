const SUPABASE_ORIGIN = "https://hwvtuybkozojypifxjto.supabase.co";

const EXACT_ORIGINS = new Set([
  "https://mianmiannb666.github.io",
  "https://playmate-workbench.vercel.app",
  "https://paimini.mianmiannb666.com"
]);

function isAllowedOrigin(origin){
  if(EXACT_ORIGINS.has(origin)) return true;
  try{
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return host.endsWith(".vercel.app") || host.endsWith(".edgeone.cool");
  }catch{
    return false;
  }
}

const ALLOWED_PREFIXES = ["/auth/v1/", "/rest/v1/"];
const ALLOWED_METHODS = new Set(["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"]);

function setCors(res, origin){
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization,apikey,content-type,prefer,range,x-client-info,x-supabase-api-version");
  res.setHeader("Access-Control-Expose-Headers", "content-range,range,x-supabase-api-version");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
}

module.exports = async function handler(req, res){
  const origin = req.headers.origin || "";

  if(!isAllowedOrigin(origin)){
    setCors(res, origin || "null");
    return res.status(403).json({error:"origin_not_allowed"});
  }

  setCors(res, origin);

  if(req.method === "OPTIONS"){
    return res.status(204).end();
  }

  if(!ALLOWED_METHODS.has(req.method)){
    return res.status(405).json({error:"method_not_allowed"});
  }

  const rawPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;
  if(!rawPath){
    return res.status(400).json({error:"missing_path"});
  }

  let path;
  try{
    path = decodeURIComponent(String(rawPath));
  }catch{
    path = String(rawPath);
  }

  if(!path.startsWith("/")) path = "/" + path;

  if(!ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix))){
    return res.status(404).json({error:"path_not_allowed"});
  }

  const query = new URL(req.url, "https://local.invalid").searchParams;
  query.delete("path");
  const qs = query.toString();
  const upstreamUrl = SUPABASE_ORIGIN + path + (qs ? "?" + qs : "");

  const headers = {};
  for(const name of [
    "authorization",
    "apikey",
    "content-type",
    "prefer",
    "range",
    "x-client-info",
    "x-supabase-api-version"
  ]){
    const value = req.headers[name];
    if(value) headers[name] = value;
  }

  const init = {
    method: req.method,
    headers,
    redirect: "manual"
  };

  if(!["GET","HEAD"].includes(req.method)){
    if(Buffer.isBuffer(req.body)){
      init.body = req.body;
    }else if(typeof req.body === "string"){
      init.body = req.body;
    }else if(req.body != null){
      init.body = JSON.stringify(req.body);
    }
  }

  try{
    const upstream = await fetch(upstreamUrl, init);
    res.status(upstream.status);

    for(const name of ["content-type","content-range","range","x-supabase-api-version"]){
      const value = upstream.headers.get(name);
      if(value) res.setHeader(name, value);
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return res.send(body);
  }catch(error){
    return res.status(502).json({
      error:"upstream_unreachable",
      message:String(error?.message || error || "proxy fetch failed")
    });
  }
};
