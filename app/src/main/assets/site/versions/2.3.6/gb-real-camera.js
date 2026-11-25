/* Launcher APK only: the Gingerbread Camera's viewfinder shows the phone's real camera, and the shutter keeps a real
   picture. One <video> element follows the viewfinder across re-renders; the camera is released as soon as the Camera
   app is left, so other apps can use it. In an ordinary browser this stays off and the Camera keeps its drawn scene. */
(() => {
  'use strict';
  const active = !!(window.GBRealApps?.active && navigator.mediaDevices?.getUserMedia);
  const video = document.createElement('video');
  video.className = 'gbx-live';
  video.muted = true; video.playsInline = true; video.autoplay = true;
  video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  let stream = null, facing = '', starting = null, failed = false;

  function stop() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null; facing = ''; starting = null;
    video.srcObject = null; video.remove();
  }
  function start(wanted) {
    if (starting && facing === wanted) return starting;
    stop(); facing = wanted;
    const constraints = {audio: false, video: {facingMode: wanted === 'front' ? 'user' : {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 960}}};
    starting = navigator.mediaDevices.getUserMedia(constraints).then(s => {
      if (facing !== wanted) { s.getTracks().forEach(track => track.stop()); return; }
      stream = s; failed = false; video.srcObject = s; video.play().catch(() => {});
    }, () => { failed = true; starting = null; });
    return starting;
  }

  /* Called after every render. show: the live viewfinder belongs on screen (Camera open, nothing under review). */
  function sync(show, wantedFacing, zoom) {
    if (!active) return;
    if (!show) { if (stream || starting) stop(); return; }
    const scene = document.querySelector('#viewport .gbcam-scene');
    if (!scene) { if (stream || starting) stop(); return; }
    if (failed && !stream) return; // permission refused: keep the drawn scene
    if (facing !== wantedFacing || (!stream && !starting)) start(wantedFacing);
    video.style.transform = `${wantedFacing === 'front' ? 'scaleX(-1) ' : ''}scale(${Math.max(1, Number(zoom) || 1)})`;
    if (video.parentNode !== scene) { scene.append(video); if (video.srcObject) video.play().catch(() => {}); }
  }

  // A frame of the live view as a JPEG, cropped to the 4:3 viewfinder: the longest side `max` px.
  function frame(max, quality) {
    if (!stream || !video.videoWidth) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    // Upright phone: a 3:4 portrait picture, like the viewfinder.
    let sw = vw, sh = vh;
    if (vw / vh > 3 / 4) sw = Math.round(vh * 3 / 4); else sh = Math.round(vw * 4 / 3);
    const zoom = Math.max(1, parseFloat((video.style.transform.match(/scale\(([\d.]+)\)/) || [])[1]) || 1);
    sw = Math.round(sw / zoom); sh = Math.round(sh / zoom);
    const scale = Math.min(1, max / Math.max(sw, sh)), canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d');
    if (facing === 'front') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.filter = getComputedStyle(video.parentNode || document.body).filter || 'none';
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /* The shutter: a small copy for the simulator's Gallery (it lives in the browser's limited storage) and the full
     picture saved to the phone's own gallery through the launcher. */
  function take() {
    const small = frame(800, .72);
    if (!small) return null;
    const full = frame(2560, .9);
    try { if (full) window.AndroidLauncher?.savePhoto?.(full); } catch (error) { /* saving to the phone is a bonus */ }
    return small;
  }

  window.GBRealCamera = {active, sync, take, stop, live: () => !!stream};
})();
