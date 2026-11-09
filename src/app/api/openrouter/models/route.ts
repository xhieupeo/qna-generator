import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey = (body.apiKey || process.env.OPENROUTER_API_KEY || "").trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenRouter API key is required." },
        { status: 400 }
      );
    }

    // Verify key with OpenRouter auth endpoint
    const authRes = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const authData = await authRes.json();

    if (!authRes.ok) {
      return NextResponse.json(
        {
          error:
            authData?.error?.message ||
            `OpenRouter rejected key (HTTP ${authRes.status})`,
        },
        { status: authRes.status }
      );
    }

    // Verified active free vision models on OpenRouter
    const freeModels = [
      {
        id: "openrouter/free",
        displayName: "OpenRouter Free Router (Auto-selects active free vision model / Recommended)",
      },
      {
        id: "nvidia/nemotron-3.5-super-vl:free",
        displayName: "NVIDIA Nemotron 3.5 Super VL (Free / 1M Context / OCR & Charts)",
      },
      {
        id: "meta-llama/llama-3.2-11b-vision-instruct:free",
        displayName: "Llama 3.2 11B Vision Instruct (Free)",
      },
      {
        id: "qwen/qwen2.5-vl-72b-instruct",
        displayName: "Qwen 2.5 VL 72B (Flagship Math OCR & Diagram Reasoning)",
      },
    ];

    return NextResponse.json({
      success: true,
      keyInfo: authData?.data || {},
      models: freeModels,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to verify OpenRouter API key." },
      { status: 500 }
    );
  }
}

