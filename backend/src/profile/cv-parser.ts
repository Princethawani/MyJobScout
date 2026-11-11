const knownSkills = [
  'accounting', 'administration', 'agriculture', 'analysis', 'communication', 'customer service',
  'data analysis', 'data collection', 'finance', ' Excel', 'human resources', 'leadership', 'logistics',
  'management', 'monitoring and evaluation', 'ms office', 'project management', 'report writing',
  'research', 'safeguarding', 'teaching', 'training', 'marketing', 'procurement', 'programming',
  'javascript', 'typescript', 'python', 'sql', 'public health', 'community development',
].map((skill) => skill.trim());

function sectionLines(text: string, headingPattern: RegExp): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start < 0) return [];
  const output: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^(education|academic|qualifications|work experience|employment|professional experience|career history|referees|references|skills|personal details|certifications)\s*:?$/i.test(line)) break;
    output.push(line);
    if (output.length >= 12) break;
  }
  return output;
}

export function extractProfile(text: string) {
  const cleanText = text.replaceAll(String.fromCharCode(0), '').replace(/[ \t]+/g, ' ').trim();
  const email = cleanText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = cleanText.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0]?.trim();
  const firstLine = cleanText.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 3 && line.length <= 80 && !line.includes('@'));
  const detectedSkills = knownSkills.filter((skill) => new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(cleanText));
  const skillsSection = sectionLines(cleanText, /^(skills|key skills|core competencies|technical skills|areas of expertise)\s*:?$/i);
  const listedSkills = skillsSection.flatMap((line) => line
    .replace(/^(?:[-*•]|\d+[.)])\s*/, '')
    .split(/[,;|•]/)
    .map((skill) => skill.trim())
    .filter((skill) => skill.length >= 2 && skill.length <= 60));
  const skills = [...new Set([...detectedSkills, ...listedSkills])].slice(0, 50);
  const roles = sectionLines(cleanText, /^(work experience|employment history|professional experience|career history)\s*:?$/i);
  const education = sectionLines(cleanText, /^(education|academic background|qualifications)\s*:?$/i);
  const referees = sectionLines(cleanText, /^(referees|references)\s*:?$/i);

  return {
    name: firstLine,
    email,
    phone,
    skills,
    roles,
    education,
    referees,
    extractionNote: 'Please check and correct every extracted field before saving. CV layouts and wording vary, so extraction may be incomplete.',
  };
}
