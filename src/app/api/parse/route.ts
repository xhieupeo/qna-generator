import { NextRequest, NextResponse } from "next/server";
import { parseUploadedExamFile } from "@/lib/file-ingest";

export const maxDuration = 60;

/**
 * Fast pre-parse endpoint that extracts question units and images from an uploaded
 * .html, .htm, or .zip exam file so the browser can solve units progressively without
 * hitting serverless timeout limits.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const { title, units } = await parseUploadedExamFile(file, {
      resolveRemoteImages: true,
    });

    if (!units || units.length === 0) {
      return NextResponse.json(
        {
          error:
            "Could not find any readable question text or images inside this file. If the website loads questions dynamically via JavaScript, try saving the full rendered page or uploading a ZIP/screenshot.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      title,
      totalUnits: units.length,
      units,
    });
  } catch (error: any) {
    console.error("Parse API error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to parse the uploaded file." },
      { status: 400 }
    );
  }
}

