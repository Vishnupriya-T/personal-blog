export const prerender = false;

const SYSTEM_CONTEXT = `You are an AI assistant for Vishnu Priya Thanda's personal website.
Vishnu is a Senior DevOps Engineer with 5+ years of experience.
Key facts:
- Currently at Freddie Mac as Senior DevOps Engineer (June 2023–Present), Dallas TX
- Previously at VISA/Techwave as DevOps Engineer (June 2020–Jan 2022), Hyderabad India
- MS in Data Science from University of Maryland, Baltimore County (GPA 4.0)
- B.Tech in CS & Engineering from IIIT Basar (RGUKT), GPA 3.8
- Certified Kubernetes Administrator (CKA) by CNCF
- Skills: Kubernetes, EKS, Terraform, Jenkins, Helm, AWS, Azure, GitHub Actions, Ansible, Python, Bash, LangChain, FAISS, OpenAI embeddings, Streamlit, SageMaker
- Projects: NestQuest Housing Chatbot (LangChain + OpenAI + FAISS), Image Segmentation Platform (PSPNet/U-Net on K8s), Large-Scale Object Detection (Hadoop/PySpark on 1.68M images)
Answer questions about Vishnu's background, skills, experience and projects in a concise, professional, friendly tone.
If asked something unrelated to Vishnu, politely redirect to his professional background.`;

const FUN_FALLBACKS = [
  "I can't reach my AI backend right now. Try again in a moment! Meanwhile, feel free to connect with Vishnu on LinkedIn.",
  "No API key configured yet — but Vishnu has 5+ years of DevOps experience with Kubernetes, AWS, and CI/CD. Ask me again soon!",
  "AI backend offline. Quick fact: Vishnu is a Certified Kubernetes Administrator with a 4.0 GPA MS in Data Science!",
];

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const question = (body?.question || '').trim();
  const history  = Array.isArray(body?.history) ? body.history : [];
  const stream   = !!body?.stream;

  if (!question) {
    return new Response(JSON.stringify({ error: 'Question is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (question.length > 4000) {
    return new Response(JSON.stringify({ error: 'Question too long (max 4000 chars)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GENAI_API_KEY
    || process.env.GEMINI_API_KEY
    || process.env.VERCEL_GEMINI_API_KEY;

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

    // Build conversational prompt with system context
    let prompt = SYSTEM_CONTEXT + '\n\n';
    for (const msg of history) {
      if (msg.text) {
        prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}\n`;
      }
    }
    prompt += `User: ${question}\nAssistant:`;

    if (stream) {
      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });

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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`));
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
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text
      || response?.text
      || '';

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

export async function GET() {
  return new Response(
    JSON.stringify({ usage: 'POST { "question": "..." } to this endpoint' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
