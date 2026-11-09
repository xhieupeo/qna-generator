import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey = (body.apiKey || process.env.GEMINI_API_KEY || "").trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required to detect available models." },
        { status: 400 }
      );
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            data?.error?.message ||
            `Google API rejected request (HTTP ${res.status}): ${res.statusText}`,
          status: res.status,
          code: data?.error?.status,
        },
        { status: res.status }
      );
    }

    // Filter models that support generateContent and are multimodal
    const rawModels: any[] = data.models || [];
    const validModels = rawModels
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => {
        const id = m.name.replace(/^models\//, "");
        return {
          id,
          displayName: m.displayName || id,
          description: m.description || "",
        };
      })
      .filter((m) => m.id.includes("flash") || m.id.includes("pro"));

    return NextResponse.json({
      success: true,
      totalAvailable: validModels.length,
      models: validModels,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to connect to Google Generative Language API." },
      { status: 500 }
    );
  }
}

