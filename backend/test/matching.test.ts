import { describe, expect, it } from 'vitest';
import { calculateJobMatch, cosineSimilarity } from '../src/jobs/matching.js';

describe('local job matching', () => {
  it('scores configured skills and preferred location without external services', () => {
    const result = calculateJobMatch({
      title: 'Data Analyst',
      location: 'Lilongwe, Malawi',
      description: 'Experience with SQL and reporting is required.',
    }, {
      skills: ['SQL', 'reporting', 'accounting'],
      preferredLocations: ['Lilongwe'],
    });

    expect(result.fitScore).toBeGreaterThan(50);
    expect(result.scoreDetails.matchedSkills).toEqual(['SQL', 'reporting']);
    expect(result.scoreDetails.missingSkills).toEqual(['accounting']);
    expect(result.scoreDetails.locationMatched).toBe(true);
  });

  it('leaves the score empty until the profile has match criteria', () => {
    expect(calculateJobMatch({ title: 'Teacher' }, {}).fitScore).toBeNull();
  });

  it('compares semantic vectors with cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1], [1, 0])).toBeNull();
  });
});
