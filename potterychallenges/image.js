// Turns a photo from the camera or library into two small plain JPEGs (full and thumbnail).
// Drawing onto a canvas and saving it again drops all hidden metadata, including GPS. Then
// inspectJpeg() checks the result, and the photo is refused if anything sensitive is still in it.
import { scaleToFit, inspectJpeg, stripJpegMetadata } from './logic.js?v=0.10';

const FULL_MAX = 2048;
const THUMB_MAX = 480;
const LIMIT = 3.9 * 1024 * 1024; // the Storage rules refuse 4 MB and over

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' }); // turns the photo upright
  } catch (e) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This browser can't open that file as a picture.")); };
      img.src = url;
    });
  }
}

const toBlob = (canvas, quality) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the photo."))), 'image/jpeg', quality));

async function render(bitmap, max) {
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  const { width, height } = scaleToFit(w, h, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent areas (from PNGs) become white instead of black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  let blob;
  for (const q of [0.85, 0.7, 0.55]) {
    blob = await toBlob(canvas, q);
    if (blob.size < LIMIT) break;
  }
  if (blob.size >= LIMIT) throw new Error('That photo is too large even after shrinking it.');
  return { blob, width, height };
}

// `log` is optional: it receives short notes for the #debug log.
export async function prepareImage(file, log = () => {}) {
  const bitmap = await loadBitmap(file);
  try {
    const full = await render(bitmap, FULL_MAX);
    const thumb = await render(bitmap, THUMB_MAX);
    for (const r of [full, thumb]) {
      const bytes = new Uint8Array(await r.blob.arrayBuffer());
      const info = inspectJpeg(bytes);
      if (!info.isJpeg) throw new Error("Couldn't prepare the photo as a JPEG.");
      if (info.sensitive.length) {
        // Some browsers write a small EXIF block of their own when saving a canvas. Cut it out
        // of the file, then check again: nothing is uploaded unless the second check is clean.
        const stripped = stripJpegMetadata(bytes);
        if (!stripped) throw new Error("Couldn't remove hidden data from the photo, so it was not uploaded.");
        const again = inspectJpeg(stripped);
        if (!again.isJpeg || again.sensitive.length) throw new Error(`Refused: hidden data (${again.sensitive.join(', ')}) could not be removed.`);
        r.blob = new Blob([stripped], { type: 'image/jpeg' });
        log(`photo: removed ${info.sensitive.join(', ')} that the browser added when saving`);
      }
    }
    return { full, thumb };
  } finally {
    bitmap.close?.();
  }
}
