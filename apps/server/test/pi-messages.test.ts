// ============================================================
// piMessagesToChatMessages 单元测试 —— thinking 块回传
// ============================================================
//
// 思考模式端点（DeepSeek 等）要求 assistant 消息回传 reasoning_content：
// 带 tool_calls 的消息缺该字段会被上游 400 拒绝
// （"The reasoning_content in the thinking mode must be passed back to the API."），
// 于是「模型调工具 → 后续轮次全空 → 空回复重试耗尽 → 兜底文案落库」。
// 本测试锁定该转换契约。

import { describe, it, expect } from 'vitest'
import { piMessagesToChatMessages } from '../src/ai/pi-adapter.js'

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }

function assistant(content: unknown[], stopReason = 'toolUse') {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'openai',
    model: 'deepseek-flash',
    usage: ZERO_USAGE,
    stopReason,
    timestamp: 0,
  } as any
}

const callBlock = {
  type: 'toolCall',
  id: 'call_1',
  name: 'dingtalk_find_department',
  arguments: { query: '繁华' },
}

describe('piMessagesToChatMessages · reasoning_content 回传', () => {
  it('thinking 块随 tool_calls 回传为 reasoning_content', () => {
    const [msg] = piMessagesToChatMessages([
      assistant([
        { type: 'thinking', thinking: '需要先查部门', thinkingSignature: 'reasoning_content' },
        { type: 'text', text: '我来查一下。' },
        callBlock,
      ]),
    ])
    expect(msg.role).toBe('assistant')
    expect(msg.reasoning_content).toBe('需要先查部门')
    expect(msg.tool_calls?.[0].function.name).toBe('dingtalk_find_department')
    expect(msg.content).toBe('我来查一下。')
  })

  it('有 tool_calls 但无 thinking 时回传空串（上游接受）', () => {
    const [msg] = piMessagesToChatMessages([assistant([callBlock])])
    expect(msg.reasoning_content).toBe('')
  })

  it('纯思考轮（无 tool_calls）也回传真实思考内容并去首尾空白', () => {
    const [msg] = piMessagesToChatMessages([
      assistant([{ type: 'thinking', thinking: '  想一下  ' }, { type: 'text', text: '答案' }], 'stop'),
    ])
    expect(msg.reasoning_content).toBe('想一下')
  })

  it('既无 thinking 也无 tool_calls 时不注入该字段', () => {
    const [msg] = piMessagesToChatMessages([assistant([{ type: 'text', text: '普通回复' }], 'stop')])
    expect('reasoning_content' in msg).toBe(false)
  })

  it('user / toolResult 消息不受影响', () => {
    const out = piMessagesToChatMessages([
      { role: 'user', content: '你好', timestamp: 0 } as any,
      { role: 'toolResult', toolCallId: 'call_1', content: [{ type: 'text', text: 'ok' }], timestamp: 0 } as any,
    ])
    expect(out[0]).toEqual({ role: 'user', content: '你好' })
    expect(out[1]).toEqual({ role: 'tool', content: 'ok', tool_call_id: 'call_1' })
  })
})
