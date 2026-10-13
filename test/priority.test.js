import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

export function calculatePriority(input) {
  let score = 30;
  const reasons = [];

  if (input.urgency === 'critical') {
    score += 40;
    reasons.push('Marked critical urgency');
  } else if (input.urgency === 'high') {
    score += 25;
    reasons.push('Marked high urgency');
  } else if (input.urgency === 'medium') {
    score += 15;
  }

  if (input.category === 'safety') {
    score += 40;
    reasons.push('Safety-sensitive category escalated immediately');
  } else if (input.category === 'transport') {
    score += 20;
    reasons.push('Transport disruption affects participant arrival');
  } else if (input.category === 'venue' || input.category === 'accessibility') {
    score += 15;
    reasons.push('Venue/accessibility operational blocker');
  }

  if (input.hasAffectedSession) {
    score += 15;
    reasons.push('Directly impacts scheduled event session');
    if (input.minutesUntilSession !== undefined && input.minutesUntilSession <= 60 && input.minutesUntilSession >= 0) {
      score += 20;
      reasons.push(`Session begins in under ${input.minutesUntilSession} minutes`);
    }
  }

  score = Math.min(100, Math.max(1, score));
  return { score, reason: reasons.join('; ') || 'Standard priority calculation based on submission' };
}

describe('Incident Priority Calculation Engine', () => {
  test('Calculates high priority for critical transport issue approaching session', () => {
    const result = calculatePriority({
      category: 'transport',
      urgency: 'critical',
      zone: 'Gate 2',
      hasAffectedSession: true,
      minutesUntilSession: 25,
    });

    assert.ok(result.score >= 90, `Score should be >= 90, got ${result.score}`);
    assert.ok(result.reason.includes('Marked critical urgency'));
    assert.ok(result.reason.includes('Transport disruption'));
    assert.ok(result.reason.includes('Directly impacts scheduled event session'));
    assert.ok(result.reason.includes('Session begins in under 25 minutes'));
  });

  test('Calculates lower priority for general non-session low urgency problem', () => {
    const result = calculatePriority({
      category: 'food',
      urgency: 'low',
      hasAffectedSession: false,
    });

    assert.ok(result.score <= 50, `Score should be <= 50, got ${result.score}`);
  });
});
