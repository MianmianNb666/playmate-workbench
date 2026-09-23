const SUPABASE_ORIGIN="https://hwvtuybkozojypifxjto.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable___YrsbZwmyv_3KbYDhZSmw_zXBazZFr";

const ALLOWED_ORIGINS=new Set([
  "https://mianmiannb666.github.io",
  "https://playmate-workbench.vercel.app"
]);

function cors(res,origin){
  if(ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin",origin);
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","authorization,content-type");
  res.setHeader("Vary","Origin");
  res.setHeader("Cache-Control","no-store");
}

async function verifyAdmin(accessToken){
  const r=await fetch(SUPABASE_ORIGIN+"/rest/v1/rpc/is_app_admin",{
    method:"POST",
    headers:{
      "authorization":"Bearer "+accessToken,
      "apikey":SUPABASE_PUBLISHABLE_KEY,
      "content-type":"application/json"
    },
    body:"{}"
  });
  if(!r.ok) return false;
  const data=await r.json().catch(()=>false);
  return data===true;
}

module.exports=async function handler(req,res){
  const origin=req.headers.origin||"";
  cors(res,origin);

  if(req.method==="OPTIONS") return res.status(204).end();
  if(req.method!=="POST") return res.status(405).json({error:"method_not_allowed"});
  if(!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({error:"origin_not_allowed"});

  const auth=String(req.headers.authorization||"");
  const accessToken=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!accessToken) return res.status(401).json({error:"missing_admin_session"});
  if(!(await verifyAdmin(accessToken))) return res.status(403).json({error:"admin_required"});

  const userId=String(req.body?.user_id||"").trim();
  const newPassword=String(req.body?.new_password||"");
  if(!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({error:"invalid_user_id"});
  if(newPassword.length<6) return res.status(400).json({error:"password_too_short"});

  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey){
    return res.status(503).json({
      error:"server_not_configured",
      message:"Vercel 还没有配置 SUPABASE_SERVICE_ROLE_KEY"
    });
  }

  try{
    const upstream=await fetch(SUPABASE_ORIGIN+"/auth/v1/admin/users/"+encodeURIComponent(userId),{
      method:"PUT",
      headers:{
        "authorization":"Bearer "+serviceKey,
        "apikey":serviceKey,
        "content-type":"application/json"
      },
      body:JSON.stringify({password:newPassword})
    });

    const textBody=await upstream.text();
    let data={};
    try{data=textBody?JSON.parse(textBody):{}}catch{data={message:textBody}}

    if(!upstream.ok){
      return res.status(upstream.status).json({
        error:"supabase_admin_update_failed",
        message:data?.msg||data?.message||data?.error_description||"密码更新失败"
      });
    }

    return res.status(200).json({success:true});
  }catch(error){
    return res.status(502).json({
      error:"upstream_unreachable",
      message:String(error?.message||error||"Supabase 请求失败")
    });
  }
};
