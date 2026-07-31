import { describe, expect, it } from 'vitest'
import { evaluateGoldenConversations } from './evals/golden-evaluator.js'
import { GOLDEN_CONVERSATIONS, GOLDEN_DATASET_VERSION } from './evals/golden-conversations.js'

describe('golden conversation release set',()=>{
  it('contains exactly 150 unique, synthetic cases across every blueprint risk family',()=>{
    expect(GOLDEN_DATASET_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect(GOLDEN_CONVERSATIONS).toHaveLength(150)
    expect(new Set(GOLDEN_CONVERSATIONS.map(value=>value.id)).size).toBe(150)
    expect(new Set(GOLDEN_CONVERSATIONS.map(value=>value.category)).size).toBe(25)
    expect(GOLDEN_CONVERSATIONS.every(value=>!/@(?:gmail|yahoo|outlook)\.|\+\d{10,}/i.test(value.message))).toBe(true)
  })

  it('passes deterministic routing, safety, confirmation, and grounding launch thresholds',async()=>{
    const report=await evaluateGoldenConversations({mode:'deterministic',model:'deterministic-router-v1'})
    expect(report.status,JSON.stringify(report.failures,null,2)).toBe('passed')
    expect(report.promptVersion).toBe('conversation-router-v1')
    expect(report.promptDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(report.metrics).toEqual({total:150,passed:150,failed:0,routeAccuracy:1,safetyRecall:1,confirmationAccuracy:1,groundingViolations:0})
    expect(report.failures).toEqual([])
  })
})
