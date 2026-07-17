import { createOpenAI } from '@ai-sdk/openai'
import { Ratelimit } from '@upstash/ratelimit'
import { kv } from '@vercel/kv'
import { streamText } from 'ai'

export const runtime = 'edge'

type GenerateOption = 'continue' | 'improve' | 'fix' | 'shorter' | 'longer' | 'zap'

type GenerateRequest = {
  prompt?: string
  option?: GenerateOption
  command?: string
}

const SYSTEM_PROMPTS: Record<GenerateOption, string> = {
  continue:
    '你是一个写作助手。请根据已有上下文自然续写，优先参考靠后的内容，控制在 200 个汉字以内并保持句子完整；适合时使用 Markdown。',
  improve:
    '你是一个写作助手。请改善现有文字的表达、清晰度和连贯性，控制在 200 个汉字以内并保持句子完整；适合时使用 Markdown。',
  fix: '你是一个写作助手。请修正现有文字中的语法、拼写和标点问题，不改变原意；适合时使用 Markdown。',
  shorter: '你是一个写作助手。请缩短现有文字，保留关键信息；适合时使用 Markdown。',
  longer: '你是一个写作助手。请扩展现有文字，补足必要细节并保持原意；适合时使用 Markdown。',
  zap: '你是一个写作助手。请严格按照用户给出的命令处理现有文字；适合时使用 Markdown。'
}

/** Novel Ask AI 的流式生成端点；配置只从服务端环境变量读取。 */
export async function POST(request: Request): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return new Response('Missing OPENAI_API_KEY - 请在 web/.env 中完成服务端配置。', {
      status: 400
    })
  }

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    const ratelimit = new Ratelimit({
      redis: kv,
      limiter: Ratelimit.slidingWindow(50, '1 d')
    })

    const { success, limit, remaining, reset } = await ratelimit.limit(`novel_ratelimit_${ip}`)

    if (!success) {
      return new Response('You have reached your request limit for the day.', {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(reset)
        }
      })
    }
  }

  const body = (await request.json()) as GenerateRequest
  const option = body.option
  const prompt = body.prompt?.trim()

  if (!option || !(option in SYSTEM_PROMPTS) || !prompt) {
    return new Response('Invalid generation request.', { status: 400 })
  }

  const userPrompt =
    option === 'zap' ? `现有文字：${prompt}\n处理命令：${body.command?.trim() || '改善这段文字'}` : prompt

  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined
  })

  const result = await streamText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPTS[option],
    prompt: userPrompt,
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0
  })

  return result.toDataStreamResponse()
}
