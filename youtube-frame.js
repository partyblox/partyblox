(function(){
  function getVideo(){
    return document.querySelector('video.html5-main-video, video');
  }
  async function open(){
    const v=getVideo();
    if(!v||typeof v.requestPictureInPicture!=='function')return;
    try{
      if(document.pictureInPictureElement===v)return;
      await v.requestPictureInPicture();
    }catch(err){
      console.warn('[PartyBlox PiP] não foi possível abrir PiP nativo:',err);
    }
  }
  async function exit(){
    try{if(document.pictureInPictureElement)await document.exitPictureInPicture();}catch(_){}
  }
  window.addEventListener('message',e=>{
    if(!e.data||e.data.source!=='partyblox-native-pip')return;
    if(e.data.action==='open')open();
    if(e.data.action==='exit')exit();
  });
})();
