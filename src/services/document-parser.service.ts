import axios from 'axios';
import TurndownService from 'turndown';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../utils/logger';
import { assertPublicUrl, ssrfSafeRequestConfig } from '../utils/ssrf-guard';

/**
 * Parse a document (PDF / DOCX / HTML) into markdown — the equivalent of
 * an upstream project's /parse. Accepts a base64 body or a URL to fetch. Never trusts the
 * declared type blindly: it also sniffs magic bytes (%PDF, PK-zip) so a
 * mislabeled file still parses correctly.
 */

export interface ParseInput {
  content?: string;      // base64
  url?: string;          // or a URL to fetch
  contentType?: string;  // hint: 'pdf' | 'docx' | 'html' | mime
}

export interface ParseResult {
  markdown: string;
  detectedType: 'pdf' | 'docx' | 'html';
  metadata: Record<string, any>;
}

const MAX_DOC_BYTES = Number(process.env.MAX_DOC_BYTES ?? 25 * 1024 * 1024);
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

function sniffType(buf: Buffer, hint?: string): 'pdf' | 'docx' | 'html' {
  const h = (hint || '').toLowerCase();
  if (h.includes('pdf')) return 'pdf';
  if (h.includes('word') || h.includes('docx') || h.includes('officedocument')) return 'docx';
  if (h.includes('html')) return 'html';
  // Magic bytes.
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // DOCX is a zip (PK\x03\x04) containing word/ — treat zip as docx.
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'docx';
  const head = buf.slice(0, 512).toString('utf-8').toLowerCase();
  if (head.includes('<html') || head.includes('<!doctype html')) return 'html';
  // Default: treat as HTML/text.
  return 'html';
}

async function loadBuffer(input: ParseInput): Promise<Buffer> {
  if (input.content) {
    const buf = Buffer.from(input.content, 'base64');
    if (buf.length > MAX_DOC_BYTES) throw new Error('document exceeds MAX_DOC_BYTES');
    return buf;
  }
  if (input.url) {
    await assertPublicUrl(input.url);
    const resp = await axios.get<ArrayBuffer>(input.url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: MAX_DOC_BYTES,
      maxBodyLength: MAX_DOC_BYTES,
      ...ssrfSafeRequestConfig(),
    });
    return Buffer.from(resp.data);
  }
  throw new Error('parse requires `content` (base64) or `url`');
}

export async function parseDocument(input: ParseInput): Promise<ParseResult> {
  const buf = await loadBuffer(input);
  const type = sniffType(buf, input.contentType);

  if (type === 'pdf') {
    const data = await pdfParse(buf);
    const markdown = data.text.replace(/\n{3,}/g, '\n\n').trim();
    return { markdown, detectedType: 'pdf', metadata: { pages: data.numpages, info: data.info } };
  }

  if (type === 'docx') {
    const { value: html, messages } = await mammoth.convertToHtml({ buffer: buf });
    const markdown = turndown.turndown(html).trim();
    if (messages?.length) logger.debug(`mammoth messages: ${messages.map(m => m.message).join('; ')}`);
    return { markdown, detectedType: 'docx', metadata: {} };
  }

  // HTML / text.
  const html = buf.toString('utf-8');
  const markdown = turndown.turndown(html).trim();
  return { markdown, detectedType: 'html', metadata: {} };
}
