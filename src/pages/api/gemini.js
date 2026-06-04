export async function post({ request }) {
  const body = await request.json().catch(() => ({}));
  const question = (body?.question || body?.q || '').trim();
  const history = Array.isArray(body?.history) ? body.history : [];
  const stream = !!body?.stream;

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
    // Input validation
    if (!question) {
      return new Response(JSON.stringify({ error: 'Question is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (question.length > 4000) {
      return new Response(JSON.stringify({ error: 'Question too long (max 4000 chars)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Build a lightweight conversational prompt from provided history.
    let prompt = '';
    if (history.length) {
      prompt = history.map(h => `${h.role || 'user'}: ${h.text}`).join('\n') + '\n';
    }
    prompt += `user: ${question}`;

    if (stream) {
      // Stream response back as Server-Sent Events (SSE)
      const responseStream = await ai.models.generateContentStream({ model: 'gemini-3.5-flash', contents: prompt });

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of responseStream) {
              const text = chunk?.text || '';
              const payload = JSON.stringify({ type: 'chunk', text });
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            }
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
            controller.close();
          } catch (err) {
            const payload = JSON.stringify({ type: 'error', error: String(err) });
            controller.enqueue(encoder.encode(`event: error\ndata: ${payload}\n\n`));
            controller.close();
          }
        }
      });

      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }

    // Non-streaming fallback: generate whole response
    const response = await ai.models.generateContent({ model: 'gemini-3.5-flash', contents: prompt });
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
