import { describe, expect, it } from 'vitest'
import { formatReply, parseReply } from '../src/marker.ts'

describe('reply format', () => {
  it('round-trips an edited approval with a comment', () => {
    const reply = {
      approval: 'toolu_1',
      decision: 'changed' as const,
      target: 'a@b.cz',
      content: 'Dobrý den,\nupravený text.',
      comment: 'shorter',
    }
    const text = formatReply(reply)
    expect(text.startsWith('Approval toolu_1: approved with changes')).toBe(true)
    expect(parseReply(text)).toEqual(reply)
  })

  it('ignores ordinary messages and malformed replies', () => {
    expect(parseReply('Approval is fine by me')).toBeUndefined()
    expect(
      parseReply('Approval x: approved\n\n```json\n{"approval":"x","decision":"maybe"}\n```'),
    ).toBeUndefined()
  })
})
