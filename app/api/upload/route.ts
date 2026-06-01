import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Magic byte signatures
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2D]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4B, 0x03, 0x04]; // PK (DOCX is a ZIP)

function validateMagicBytes(uint8: Uint8Array, ext: string): boolean {
  if (uint8.length < 5) return false;

  if (ext === 'pdf') {
    return PDF_MAGIC.every((byte, i) => uint8[i] === byte);
  }

  if (ext === 'docx') {
    return ZIP_MAGIC.every((byte, i) => uint8[i] === byte);
  }

  return true; // txt files don't need magic byte validation
}

async function extractPdfText(uint8: Uint8Array): Promise<string> {
  const candidates = [
    'pdfjs-dist/legacy/build/pdf.mjs',
    'pdfjs-dist/build/pdf.mjs',
  ];

  let lastErr: unknown;
  for (const mod of candidates) {
    try {
      const pdfjs = await import(mod);
      if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = '';

      const doc = await pdfjs.getDocument({ data: uint8, useSystemFonts: true, disableWorker: true }).promise;
      const pageTexts: string[] = [];

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const lines = (content.items || [])
          .map((item: any) => item?.str)
          .filter((v: unknown) => typeof v === 'string' && v.trim().length > 0)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (lines) pageTexts.push(lines);
      }

      return pageTexts.join('\n\n').trim();
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Failed to parse PDF');
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File too large. Maximum size is 10MB.' }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ success: false, error: 'File is empty.' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    
    if (ext === 'txt') {
      const text = await file.text();
      if (!text.trim()) return NextResponse.json({ success: false, error: 'File contains no text content.' }, { status: 400 });
      return NextResponse.json({ success: true, data: { text, name: file.name } });
    }

    if (ext === 'docx') {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      // Validate magic bytes (DOCX is a ZIP archive)
      if (!validateMagicBytes(uint8, 'docx')) {
        return NextResponse.json({ success: false, error: 'File does not appear to be a valid DOCX file.' }, { status: 400 });
      }

      const mammoth = await import('mammoth');
      const buffer = Buffer.from(arrayBuffer);
      const result = await mammoth.extractRawText({ buffer });
      if (!result.value.trim()) return NextResponse.json({ success: false, error: 'Document contains no text content.' }, { status: 400 });
      return NextResponse.json({ success: true, data: { text: result.value, name: file.name } });
    }

    if (ext === 'pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      // Validate magic bytes (PDF starts with %PDF-)
      if (!validateMagicBytes(uint8, 'pdf')) {
        return NextResponse.json({ success: false, error: 'File does not appear to be a valid PDF file.' }, { status: 400 });
      }

      const fullText = await extractPdfText(uint8);

      if (!fullText.trim()) {
        return NextResponse.json(
          { success: false, error: 'PDF contains no extractable text. It may be a scanned/image-based PDF.' },
          { status: 400 }
        );
      }

      return NextResponse.json({ success: true, data: { text: fullText.trim(), name: file.name } });
    }

    return NextResponse.json(
      { success: false, error: `Unsupported file type: .${ext}. Supported: .txt, .docx, .pdf` },
      { status: 400 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to parse file';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
