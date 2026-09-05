const path=require("path"),fs=require("fs"),http=require("http");
const express=require("express"),multer=require("multer"),{WebSocketServer}=require("ws");
const PORT=process.env.PORT||3000;
const app=express(),publicDir=__dirname,uploadsDir=path.join(publicDir,"uploads");
fs.mkdirSync(uploadsDir,{recursive:true});
const upload=multer({storage:multer.diskStorage({destination:(_r,_f,cb)=>cb(null,uploadsDir),filename:(req,file,cb)=>cb(null,Date.now()+"-"+path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g,""))}),limits:{fileSize:300*1024*1024}});
app.use(express.static(publicDir));
app.use("/uploads",express.static(uploadsDir));
app.post("/upload",upload.single("media"),(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Nenhum arquivo enviado."});
  const t=req.file.mimetype||"";
  if(!t.startsWith("video/")&&!t.startsWith("audio/")&&!t.startsWith("image/")){fs.unlinkSync(req.file.path);return res.status(400).json({error:"Envie imagem, vídeo ou áudio."});}
  res.json({url:`/uploads/${req.file.filename}`,type:t});
});
const server=http.createServer(app),wss=new WebSocketServer({server}),rooms=new Map();
const getRoom=id=>{if(!rooms.has(id))rooms.set(id,{host:null,clients:new Set(),state:{dayMode:"day",media:{type:"clear"}}});return rooms.get(id);};
const send=(ws,p)=>{if(ws.readyState===1)ws.send(JSON.stringify(p));};
const broadcast=(room,p,except=null)=>{for(const c of room.clients)if(c!==except)send(c,p);};
wss.on("connection",ws=>{
  ws.room=null;ws.name="Player";ws.pid=null;
  ws.on("message",raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.kind==="join"){
      const room=getRoom(String(m.room||"Praca-VIP").slice(0,40));
      ws.room=room;ws.name=String(m.name||"Player").slice(0,20);ws.pid=String(m.playerId||"").slice(0,40);
      room.clients.add(ws);if(!room.host)room.host=ws;
      send(ws,{kind:"roomState",host:room.host===ws,state:room.state});
      broadcast(room,{kind:"playerJoined",name:ws.name,playerId:ws.pid},ws);
      return;
    }
    const room=ws.room;if(!room)return;
    if(m.kind==="media"){if(ws!==room.host)return;room.state.media=m.state||{type:"clear"};broadcast(room,{kind:"media",state:room.state.media});return;}
    if(m.kind==="dayNight"){if(ws!==room.host)return;room.state.dayMode=m.mode==="night"?"night":"day";broadcast(room,{kind:"dayNight",mode:room.state.dayMode});return;}
    if(m.kind==="chat"){
      const text=String(m.text||"").slice(0,200);if(!text)return;
      if(m.to){for(const c of room.clients){if(c.name===m.to){send(c,{kind:"chat",name:ws.name,text,pid:ws.pid,to:m.to});break;}}return;}
      broadcast(room,{kind:"chat",name:ws.name,text,pid:ws.pid},ws);return;
    }
    if(m.kind==="position"){broadcast(room,{kind:"position",playerId:ws.pid,name:ws.name,x:m.x,y:m.y,z:m.z,ry:m.ry},ws);return;}
    if(m.kind==="emote"){broadcast(room,{kind:"emote",playerId:ws.pid,id:m.id,name:ws.name},ws);return;}
  });
  ws.on("close",()=>{
    const room=ws.room;if(!room)return;
    room.clients.delete(ws);
    broadcast(room,{kind:"playerLeft",name:ws.name,playerId:ws.pid});
    if(room.host===ws){room.host=room.clients.values().next().value||null;if(room.host)send(room.host,{kind:"roomState",host:true,state:room.state});}
    if(room.clients.size===0)for(const[k,r]of rooms)if(r===room)rooms.delete(k);
  });
});
server.listen(PORT,()=>console.log(`OpenVerse online em http://localhost:${PORT}`));
