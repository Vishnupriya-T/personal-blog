export const prerender = false;

const SYSTEM_CONTEXT = `You are an AI assistant for Vishnu Priya Thanda's personal website.
Vishnu is a Senior DevOps Engineer with 5+ years of experience.
Important: Vishnu Priya Thanda is a woman. Use she/her pronouns when referring to her.
Key facts:
- Currently at Freddie Mac as Senior DevOps Engineer (June 2023–Present), Dallas TX
- Previously at VISA/Techwave as DevOps Engineer (June 2020–Jan 2022), Hyderabad India
- MS in Data Science from University of Maryland, Baltimore County (GPA 4.0)
- B.Tech in CS & Engineering from IIIT Basar (RGUKT), GPA 3.8
- Certified Kubernetes Administrator (CKA) by CNCF
- Skills: Kubernetes, EKS, Terraform, Jenkins, Helm, AWS, Azure, GitHub Actions, Ansible, Python, Bash, LangChain, FAISS, OpenAI embeddings, Streamlit, SageMaker
- Projects: NestQuest Housing Chatbot (LangChain + OpenAI + FAISS), Image Segmentation Platform (PSPNet/U-Net on K8s), Large-Scale Object Detection (Hadoop/PySpark on 1.68M images)
Answer questions about Vishnu's background, skills, experience and projects in a concise, professional, friendly tone.
If asked something unrelated to Vishnu, politely redirect to her professional background.`;

// Ordered fallback list — tries each until one succeeds (handles model deprecations).
// gemini-3.1-flash-lite = stable lite model as of June 2026.
const MODEL_FALLBACKS = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

const OFFLINE_MESSAGES = [
  "I can't reach my AI backend right now. Meanwhile — Vishnu has 5+ years of DevOps experience with Kubernetes, AWS and CI/CD. Feel free to explore the blog or reach out on LinkedIn!",
  "No API key configured. Quick facts: Vishnu is a Certified Kubernetes Administrator with a 4.0 GPA MS in Data Science from UMBC!",
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function friendlyError(err) {
  const msg = String(err);
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return { code: 429, userMessage: "⏳ I've hit my request limit for now. Please try again in a minute, or connect with Vishnu directly on LinkedIn!" };
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('API_KEY')) {
    return { code: 403, userMessage: '🔑 AI backend not configured. Please check back later!' };
  }
  if (msg.includes('503') || msg.includes('overloaded') || msg.includes('UNAVAILABLE')) {
    return { code: 503, userMessage: '🔄 The AI model is temporarily overloaded. Try again in a few seconds!' };
  }
  if (msg.includes('404') || msg.includes('not found') || msg.includes('NOT_FOUND')) {
    return { code: 404, userMessage: '🔄 Model unavailable, trying backup. Please try again!' };
  }
  return { code: 500, userMessage: '⚠️ Something went wrong. Please try again shortly.' };
}

/**
 * Try each model in MODEL_FALLBACKS until one succeeds.
 * Returns { result, model } or throws the last error.
 */
async function withModelFallback(ai, fn) {
  let lastErr;
  for (const model of MODEL_FALLBACKS) {
    try {
      const result = await fn(model);
      return { result, model };
    } catch (err) {
      const msg = String(err);
      // Only continue to next model on 404 (model not found) errors
      if (msg.includes('404') || msg.includes('not found') || msg.includes('NOT_FOUND')) {
        lastErr = err;
        continue;
      }
      throw err; // re-throw quota/auth errors immediately
    }
  }
  throw lastErr;
}

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const question = (body?.question || '').trim();
  const history  = Array.isArray(body?.history) ? body.history : [];
  const stream   = !!body?.stream;

  if (!question) return jsonResponse({ error: 'Question is required' }, 400);
  if (question.length > 4000) return jsonResponse({ error: 'Question too long (max 4000 chars)' }, 400);

  const apiKey =
    process.env.GENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.VERCEL_GEMINI_API_KEY;

  if (!apiKey) {
    const text = OFFLINE_MESSAGES[Math.floor(Math.random() * OFFLINE_MESSAGES.length)];
    return jsonResponse({ text, fallback: true });
  }

  // Build prompt with system context + conversation history
  let prompt = SYSTEM_CONTEXT + '\n\n';
  for (const msg of history) {
    if (msg.text) {
      prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}\n`;
    }
  }
  prompt += `User: ${question}\nAssistant:`;

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    if (stream) {
      let responseStream, usedModel;
      try {
        const { result, model } = await withModelFallback(ai, (m) =>
          ai.models.generateContentStream({ model: m, contents: prompt })
        );
        responseStream = result;
        usedModel = model;
      } catch (err) {
        const { code, userMessage } = friendlyError(err);
        return jsonResponse({ error: userMessage, code }, code);
      }

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of responseStream) {
              const text = chunk?.text || '';
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`));
            }
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
            controller.close();
          } catch (err) {
            const { userMessage } = friendlyError(err);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: userMessage })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // Non-streaming
    let response, usedModel;
    try {
      const { result, model } = await withModelFallback(ai, (m) =>
        ai.models.generateContent({ model: m, contents: prompt })
      );
      response  = result;
      usedModel = model;
    } catch (err) {
      const { code, userMessage } = friendlyError(err);
      return jsonResponse({ error: userMessage, code }, code);
    }

    const text =
      response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      response?.text ||
      '';

    return jsonResponse({ text, fallback: false, model: usedModel });

  } catch (err) {
    const { code, userMessage } = friendlyError(err);
    return jsonResponse({ error: userMessage, code }, code);
  }
}

export async function GET() {
  return jsonResponse({
    usage: 'POST { "question": "..." } to this endpoint',
    models: MODEL_FALLBACKS,
  });
}
