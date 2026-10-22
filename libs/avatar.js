'use strict';

const sharp = require('sharp');
const { InputError } = require('./validation');

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const FORMATS = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

async function normalizeAvatar(value) {
  if (value === null) return null;
  const invalid = () => new InputError('Scegli un’immagine JPG, PNG o WebP valida, fino a 5 MB.', 400, 'INVALID_AVATAR');
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 40) throw invalid();
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw invalid();
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw invalid();
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== FORMATS[match[1]] || (metadata.pages || 1) > 1) throw invalid();
    // Re-encode the pixels: discard metadata, including any GPS/EXIF information.
    const output = await image.rotate().resize(256, 256, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
    return `data:image/webp;base64,${output.toString('base64')}`;
  } catch {
    throw invalid();
  }
}

async function normalizeProfileAvatar(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.avatar === undefined) return input;
  return { ...input, avatar: await normalizeAvatar(input.avatar) };
}

module.exports = { normalizeAvatar, normalizeProfileAvatar, MAX_AVATAR_BYTES };
