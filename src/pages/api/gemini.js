export async function post({ request }) {
  const body = await request.json().catch(() => ({}));
  const question = body?.question || body?.q || '';

  const FUN_FALLBACKS = [
    "I can't reach my brain servers right now — but I do know you're amazing! Ask me again in a bit.",
    "My AI wings are taking a short nap. Meanwhile: you're a cloud-native superstar!",
    "No Gemini key found — here's a random fun fact: Honey never spoils. Now ask me about your work!",
    "I'm offline for a sec. Pro tip: Kubernetes + automation = happiness. Try me again soon!",
  ];

  const apiKey = process.env.GENAI_API_KEY || process.env.VERCEL_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const text = FUN_FALLBACKS[Math.floor(Math.random() * FUN_FALLBACKS.length)];
    return new Response(JSON.stringify({ text, fallback: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    // The SDK supports both simple string contents and more structured inputs.
    const contents = question || "Tell me about Vishnu Priya Thanda's background and experience.";

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents,
    });

    const text = response?.candidates?.[0]?.content?.text || response?.text || '';

    return new Response(JSON.stringify({ text, fallback: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function get() {
  const info = {
    usage: 'POST JSON { "question": "..." } to this endpoint',
    envVars: ['GENAI_API_KEY', 'VERCEL_GEMINI_API_KEY', 'GEMINI_API_KEY'],
  };
  return new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json' } });
}
