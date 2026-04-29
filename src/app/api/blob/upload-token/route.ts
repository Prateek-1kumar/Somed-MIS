// Issues signed Vercel Blob upload tokens for the upload flow. Each upload
// gets a unique staging pathname (data/staging/<timestamp>-<rand>.csv) so
// concurrent uploads can't overwrite each other and the ingest route can
// delete its own blob without racing.
//
// Header schema validation runs here (cheap rejection before any blob bytes
// are written). The CSV body itself is parsed server-side later by /api/data/ingest.

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { CSV_COLUMNS } from '@/lib/schema';

export const runtime = 'nodejs';

const EXPECTED_HEADER = CSV_COLUMNS.join(',');
const MAX_BYTES = 1024 * 1024 * 1024;
const STAGING_PATH = /^data\/staging\/[a-zA-Z0-9_-]+\.csv$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!STAGING_PATH.test(pathname)) {
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
          allowOverwrite: false,
          maximumSizeInBytes: MAX_BYTES,
        };
      },
      onUploadCompleted: async () => {
        // no-op — ingest is triggered explicitly by the client after upload.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
