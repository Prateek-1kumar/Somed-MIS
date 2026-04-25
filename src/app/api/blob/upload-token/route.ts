import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { CSV_COLUMNS } from '@/lib/schema';

export const runtime = 'nodejs';

const EXPECTED_HEADER = CSV_COLUMNS.join(',');
const MAX_BYTES = 1024 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (pathname !== 'accumulated.csv') {
          throw new Error(`Refusing to issue token for unexpected pathname: ${pathname}`);
        }
        let header = '';
        try {
          const parsed = JSON.parse(clientPayload ?? '{}') as { header?: string };
          header = (parsed.header ?? '').replace(/^﻿/, '').trim();
        } catch {
          throw new Error('Missing clientPayload with CSV header');
        }
        if (header !== EXPECTED_HEADER) {
          throw new Error(
            `CSV header does not match the expected ${CSV_COLUMNS.length}-column schema. Upload refused.`,
          );
        }
        return {
          allowedContentTypes: ['text/csv', 'application/vnd.ms-excel', 'application/octet-stream'],
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: MAX_BYTES,
        };
      },
      onUploadCompleted: async () => {
        // no-op
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
