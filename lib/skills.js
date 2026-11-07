// Skill vocabulary used by the keyword fallback (no AI key) for resume parsing
// and job matching. Each entry: canonical name -> extra aliases.
const SKILLS = {
  // Design
  'Figma': [], 'Sketch': [], 'Adobe XD': ['xd'], 'Photoshop': [], 'Illustrator': [], 'InDesign': [],
  'After Effects': [], 'Framer': [], 'Prototyping': ['prototype', 'prototypes'], 'Wireframing': ['wireframe', 'wireframes'],
  'User Research': ['usability testing', 'user interviews'], 'Design Systems': ['design system'],
  'UI Design': ['ui designer', 'interface design'], 'UX Design': ['ux designer', 'user experience'],
  'Interaction Design': [], 'Visual Design': [], 'Accessibility': ['wcag', 'a11y'], 'Information Architecture': [],
  'Motion Design': [], 'Typography': [],
  // Data
  'SQL': ['mysql', 'postgresql', 'postgres', 'sqlite'], 'Excel': ['spreadsheets', 'vlookup', 'pivot tables'],
  'Power BI': ['powerbi'], 'Tableau': [], 'Looker': [], 'Google Analytics': [], 'Python': [], 'R': [],
  'Pandas': [], 'NumPy': ['numpy'], 'Statistics': ['statistical'], 'Machine Learning': ['ml'],
  'Deep Learning': [], 'TensorFlow': [], 'PyTorch': [], 'scikit-learn': ['sklearn'], 'Data Visualization': ['dashboards'],
  'A/B Testing': ['ab testing', 'experimentation'], 'ETL': [], 'Spark': ['pyspark'], 'BigQuery': [], 'Snowflake': [],
  'NLP': ['natural language processing'], 'Data Cleaning': [],
  // Engineering
  'JavaScript': ['js', 'es6'], 'TypeScript': ['ts'], 'React': ['react.js', 'reactjs'], 'Next.js': ['nextjs'],
  'Vue': ['vue.js'], 'Angular': [], 'Node.js': ['nodejs', 'node'], 'Express': [], 'HTML': ['html5'], 'CSS': ['css3', 'sass', 'scss'],
  'Tailwind': ['tailwindcss'], 'Java': [], 'Spring': ['spring boot'], 'C++': [], 'C#': ['.net', 'dotnet'], 'Go': ['golang'],
  'Rust': [], 'Kotlin': [], 'Swift': [], 'Flutter': [], 'React Native': [], 'Django': [], 'Flask': [], 'FastAPI': [],
  'REST APIs': ['rest api', 'restful'], 'GraphQL': [], 'MongoDB': [], 'Redis': [], 'Docker': [], 'Kubernetes': ['k8s'],
  'AWS': ['amazon web services'], 'Azure': [], 'GCP': ['google cloud'], 'CI/CD': ['github actions', 'jenkins'],
  'Git': ['github', 'gitlab'], 'Linux': [], 'Software Testing': ['jest', 'unit testing', 'cypress', 'playwright', 'selenium', 'qa testing'],
  'System Design': [], 'Microservices': [],
  // Business / marketing / product
  'Product Management': ['product manager', 'roadmap'], 'Agile': ['scrum', 'jira'], 'SEO': [], 'Content Writing': ['copywriting'],
  'Social Media': [], 'Digital Marketing': ['performance marketing'], 'Communication': ['communication skills'],
  'Stakeholder Management': [], 'Project Management': [], 'Salesforce': [], 'CRM': [], 'Market Research': [],
  'Financial Analysis': ['financial modelling', 'financial modeling'], 'Business Analysis': ['business analyst'],
  'Presentation': ['powerpoint', 'presentations'],
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Precompile one boundary-aware regex per canonical skill.
const MATCHERS = Object.entries(SKILLS).map(([name, aliases]) => {
  const terms = [name, ...aliases].map((t) => escape(t.toLowerCase()));
  // Custom boundaries so "C++", "C#" and "Next.js" match, but "R" does not match inside words.
  return { name, re: new RegExp(`(^|[^a-z0-9+#])(${terms.join('|')})(?=$|[^a-z0-9+#])`, 'i') };
});

/** Return canonical skill names that appear in the text. */
export function findSkills(text) {
  const lower = ` ${String(text || '').toLowerCase()} `;
  const found = [];
  for (const { name, re } of MATCHERS) {
    // Single-letter "R" is too noisy: require "R programming" / ", R," style context.
    if (name === 'R') {
      if (/(^|[\s,(/])r(\s+programming|\s*[,/)]|\s+studio)/i.test(lower) && /python|sql|statistic|data/i.test(lower)) found.push(name);
      continue;
    }
    if (re.test(lower)) found.push(name);
  }
  return found;
}

export const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();

// normalised name/alias -> canonical skill name
const CANON = new Map();
for (const [name, aliases] of Object.entries(SKILLS)) for (const t of [name, ...aliases]) CANON.set(normaliseRaw(t), name);
function normaliseRaw(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim(); }
const canonical = (s) => CANON.get(normaliseRaw(s)) || normaliseRaw(s);

/** Case-insensitive membership that treats a skill's aliases as the same skill. */
export function hasSkill(skillList, skill) {
  const target = canonical(skill);
  return skillList.some((s) => canonical(s) === target);
}

const ROLE_WORDS = [
  'designer', 'developer', 'engineer', 'analyst', 'scientist', 'manager', 'intern', 'consultant', 'architect',
  'researcher', 'specialist', 'associate', 'lead', 'executive', 'coordinator', 'writer', 'marketer', 'administrator',
];

/** Lines that look like job titles (e.g. "UI/UX Designer — Acme"). */
export function findTitles(text) {
  const titles = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 4 || line.length > 80) continue;
    const head = line.split(/\s[-–—|@,]\s|\s+at\s+/i)[0].trim();
    if (head.split(/\s+/).length > 6) continue;
    if (ROLE_WORDS.some((w) => new RegExp(`\\b${w}s?\\b`, 'i').test(head))) {
      titles.add(head.replace(/[•·*]/g, '').trim());
    }
    if (titles.size >= 6) break;
  }
  return [...titles];
}
