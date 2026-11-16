import { describe, expect, it } from 'vitest';
import { calculateJobMatch, combineHybridScore, cosineSimilarity } from '../src/jobs/matching.js';

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

  it('requires whole-word skill matches instead of matching inside unrelated words', () => {
    const result = calculateJobMatch({ title: 'Driver', description: 'Must understand local road laws.' }, { skills: ['AWS'] });
    expect(result.scoreDetails.matchedSkills).toEqual([]);
    expect(result.scoreDetails.missingSkills).toEqual(['AWS']);
  });

  it('matches skill terms as whole words or phrases', () => {
    const result = calculateJobMatch({ title: 'Cloud Engineer', description: 'Experience with AWS and Node.js required.' }, { skills: ['AWS', 'Node.js'] });
    expect(result.scoreDetails.matchedSkills).toEqual(['AWS', 'Node.js']);
  });

  it('reduces semantic weight when none of the declared skills match', () => {
    expect(combineHybridScore(71, 0, true, false)).toEqual({ fitScore: 21, semanticWeight: 0.3 });
    expect(combineHybridScore(71, 2, true, true)).toEqual({ fitScore: 50, semanticWeight: 0.7 });
  });

  it('compares semantic vectors with cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1], [1, 0])).toBeNull();
  });
});
