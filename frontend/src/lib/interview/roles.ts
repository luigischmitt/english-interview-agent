/** Target roles offered in the setup selector. The candidate can still type any other role. */
export const interviewRoles = [
  "Software Engineer",
  "Frontend Engineer",
  "Backend Engineer",
  "Full-Stack Engineer",
  "Mobile Engineer",
  "DevOps Engineer",
  "Site Reliability Engineer",
  "Cloud Engineer",
  "Data Engineer",
  "Data Scientist",
  "Data Analyst",
  "Machine Learning Engineer",
  "AI Engineer",
  "AI Deployment Engineer",
  "QA Automation Engineer",
  "Security Engineer",
  "Engineering Manager",
] as const;

export type InterviewRole = (typeof interviewRoles)[number];
