// 派Mini Supabase 中转 Worker
// 部署平台：Cloudflare Workers
// 仅转发当前派Mini需要的 Supabase Auth / REST 请求。
// 不使用 service_role，不绕过 Supabase RLS。

const SUPABASE_ORIGIN = "https://hwvtuybkozojypifxjto.supabase.co";

const EXACT_ORIGINS = new Set([
  "https://mianmiannb666.github.io",
  "https://playmate-workbench.vercel.app",
  "https://paimini.mianmiannb666.com"
]);

function isAllowedOrigin(origin){
  if(EXACT_ORIGINS.has(origin)) return true;
  try{
    const url=new URL(origin);
    const host=url.hostname.toLowerCase();
    return host.endsWith(".vercel.app") || host.endsWith(".edgeone.cool");
  }catch{
    return false;
  }
}

const ALLOWED_PREFIXES = [
  "/auth/v1/",
  "/rest/v1/"
];

const ALLOWED_METHODS = new Set(["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"]);

function corsHeaders(origin){
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,prefer,range,x-client-info,x-supabase-api-version",
    "Access-Control-Expose-Headers": "content-range,range,x-supabase-api-version",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(body,status,origin){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      ...corsHeaders(origin)
    }
  });
}

export default {
  async fetch(request){
    const origin=request.headers.get("Origin")||"";

    if(!isAllowedOrigin(origin)){
      return json({error:"origin_not_allowed"},403,origin||"null");
    }

    if(request.method==="OPTIONS"){
      return new Response(null,{status:204,headers:corsHeaders(origin)});
    }

    if(!ALLOWED_METHODS.has(request.method)){
      return json({error:"method_not_allowed"},405,origin);
    }

    const incoming=new URL(request.url);
    if(!ALLOWED_PREFIXES.some(prefix=>incoming.pathname.startsWith(prefix))){
      return json({error:"path_not_allowed"},404,origin);
    }

    const upstreamUrl=SUPABASE_ORIGIN + incoming.pathname + incoming.search;

    const headers=new Headers();
    for(const name of [
      "authorization",
      "apikey",
      "content-type",
      "prefer",
      "range",
      "x-client-info",
      "x-supabase-api-version"
    ]){
      const value=request.headers.get(name);
      if(value) headers.set(name,value);
    }

    try{
      const init={
        method:request.method,
        headers,
        redirect:"manual"
      };

      if(!["GET","HEAD"].includes(request.method)){
        init.body=await request.arrayBuffer();
      }

      const upstream=await fetch(upstreamUrl,init);
      const responseHeaders=new Headers(upstream.headers);

      for(const [key,value] of Object.entries(corsHeaders(origin))){
        responseHeaders.set(key,value);
      }

      responseHeaders.set("Cache-Control","no-store");

      return new Response(upstream.body,{
        status:upstream.status,
        statusText:upstream.statusText,
        headers:responseHeaders
      });
    }catch(error){
      return json({
        error:"upstream_unreachable",
        message:String(error?.message||error||"proxy fetch failed")
      },502,origin);
    }
  }
};
