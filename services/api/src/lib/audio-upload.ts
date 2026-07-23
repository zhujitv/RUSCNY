import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { badRequest } from '../errors.js';

export interface AudioUpload {
  audio: Buffer;
  filename: string;
  mimeType: string;
  fields: Record<string, string>;
}

export async function readAudioUpload(request: FastifyRequest): Promise<AudioUpload> {
  if (!request.isMultipart()) {
    throw badRequest('MULTIPART_REQUIRED', '请使用 multipart/form-data 上传录音');
  }

  let audio: Buffer | undefined;
  let filename = '';
  let mimeType = '';
  const fields: Record<string, string> = {};

  for await (const part of request.parts({
    limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1, fields: 10 },
  })) {
    if (part.type === 'file') {
      if (part.fieldname !== 'audio') {
        part.file.resume();
        throw badRequest('INVALID_AUDIO', '录音文件字段必须为 audio');
      }
      if (audio) {
        part.file.resume();
        throw badRequest('INVALID_AUDIO', '一次只能上传一个录音文件');
      }
      filename = part.filename;
      mimeType = part.mimetype;
      audio = await part.toBuffer();
      if (part.file.truncated || audio.length === 0 || audio.length > config.UPLOAD_MAX_BYTES) {
        throw badRequest('INVALID_AUDIO', '录音为空或超过大小限制');
      }
    } else {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }

  if (!audio) throw badRequest('INVALID_AUDIO', '缺少录音文件');
  return { audio, filename, mimeType, fields };
}

export function validateMimeType(mimeType: string, filename: string): void {
  const baseMimeType = mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  const allowed = new Set([
    'audio/aac',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/mpeg',
    'audio/ogg',
    'audio/opus',
    'audio/webm',
    'audio/wav',
    'audio/x-wav',
    'application/octet-stream',
  ]);
  if (!allowed.has(baseMimeType) || !/\.(aac|m4a|mp3|ogg|opus|wav|webm)$/i.test(filename)) {
    throw badRequest('INVALID_AUDIO', '不支持的录音格式');
  }
}

export function normalizeMimeType(mimeType: string, filename: string): string {
  const baseMimeType = mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  if (baseMimeType !== 'application/octet-stream') return baseMimeType;
  if (/\.m4a$/i.test(filename)) return 'audio/mp4';
  if (/\.mp3$/i.test(filename)) return 'audio/mpeg';
  if (/\.ogg$/i.test(filename)) return 'audio/ogg';
  if (/\.opus$/i.test(filename)) return 'audio/opus';
  if (/\.webm$/i.test(filename)) return 'audio/webm';
  if (/\.wav$/i.test(filename)) return 'audio/wav';
  return 'audio/aac';
}
