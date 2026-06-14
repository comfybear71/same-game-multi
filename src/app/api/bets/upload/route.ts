import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

// Upload a bet-slip screenshot to Vercel Blob. Returns the public URL.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not set" },
      { status: 500 },
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no file" }, { status: 400 });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "slip.png";
    const blob = await put(`bet-slips/${Date.now()}-${safeName}`, file, {
      access: "public",
      token: env.BLOB_READ_WRITE_TOKEN,
      contentType: file.type || "image/png",
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
