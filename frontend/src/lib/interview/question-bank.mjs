// Fixed interview question bank, one list of 15 questions per role plus a generic list.
// Order: introduction, role-specific and behavioral questions (most representative first), closing.
// Every prompt is a single spoken-friendly question (one "?", no line breaks, up to 220 characters).

const q = (id, prompt, cue) => ({ id, prompt, cue });

const introduction = q(
  "introduction",
  "Can you tell me about your experience and what makes you a strong fit for {role}?",
  "Give a concise overview, then connect one strength to the role.",
);
const closing = q(
  "closing",
  "What would you like to ask about the team or the role?",
  "Ask one thoughtful question that helps you evaluate the opportunity.",
);
const ownership = q(
  "ownership",
  "Can you describe a project you owned from start to finish, including your part and the result?",
  "Set the context, explain your contribution, and finish with the outcome.",
);
const conflict = q(
  "conflict",
  "How did you handle a time when you disagreed with a teammate?",
  "Show how you listened, communicated, and moved the work forward.",
);
const failure = q(
  "failure",
  "What is a mistake you made at work, and what did you learn from it?",
  "Own the mistake, explain the fix, and name one habit you changed.",
);
const feedback = q(
  "feedback",
  "What is a piece of feedback that changed the way you work?",
  "Give the original feedback and one concrete behavior you changed.",
);
const impact = q(
  "impact",
  "How do you know when your work has made a real impact?",
  "Use a specific result or signal rather than only describing activity.",
);

// Interleaves eight role-specific questions with the five shared behavioral ones.
function buildBank(technical) {
  if (technical.length !== 8) throw new Error("Each role needs exactly 8 technical questions.");
  const [t1, t2, t3, t4, t5, t6, t7, t8] = technical;
  return [introduction, t1, t2, ownership, t3, conflict, t4, failure, t5, t6, feedback, t7, impact, t8, closing];
}

const technicalByRole = {
  "Software Engineer": [
    q("system-design", "How would you design a service that sends notifications to millions of users?", "Clarify requirements, outline the main parts, then discuss trade-offs."),
    q("debugging", "What is a hard bug you debugged, and how did you find the cause?", "Explain your investigation steps and what finally revealed the cause."),
    q("trade-off", "What is a technical trade-off you had to make, and why did you choose that option?", "Name the options, the constraint, and why your decision was reasonable."),
    q("code-quality", "How do you keep code easy to maintain when a team is moving fast?", "Give two or three practical habits and one real example."),
    q("code-review", "What do you look for when you review a teammate's pull request?", "Mention correctness, clarity, and how you give kind feedback."),
    q("testing", "How do you decide what to test, and how deeply?", "Explain how risk guides your testing strategy."),
    q("performance", "Can you describe a time you improved the performance of a system, and what did you measure?", "Describe the symptom, the measurement, the change, and the result."),
    q("technical-debt", "How do you decide when to pay down technical debt instead of building new features?", "Connect the decision to business risk and team speed."),
  ],
  "Frontend Engineer": [
    q("web-performance", "A web page feels slow for users. How would you find the problem and fix it?", "Mention measuring first, then the most likely bottlenecks."),
    q("state-management", "How do you decide where state should live in a complex front-end application?", "Compare local, shared, and server state with an example."),
    q("accessibility", "How do you make sure your interfaces are accessible to everyone?", "Give concrete practices like semantic HTML, keyboard use, and testing."),
    q("component-design", "How do you design a reusable component that other teams will use?", "Talk about the API, flexibility, and keeping it simple."),
    q("frontend-debugging", "Tell me about a tricky bug that only happened in the browser. How did you solve it?", "Explain how you reproduced it and isolated the cause."),
    q("frontend-testing", "How do you test a front-end application at the unit, component, and end-to-end levels?", "Separate unit, component, and end-to-end tests."),
    q("design-collaboration", "How do you work with designers when a design is hard to build or unclear?", "Show how you communicate trade-offs early and kindly."),
    q("rendering-strategy", "When would you choose server-side rendering over client-side rendering?", "Link the choice to user experience, SEO, and complexity."),
  ],
  "Backend Engineer": [
    q("api-design", "How do you design an API that other teams can use for years without breaking it?", "Cover naming, versioning, errors, and backward compatibility."),
    q("database-design", "How do you choose between a relational database and a NoSQL database?", "Compare access patterns, consistency, and scale with an example."),
    q("scaling", "Your service is slow under heavy traffic. How would you find the bottleneck and scale it?", "Start with measuring, then discuss caching, queries, and scaling."),
    q("reliability", "How do you make a backend service reliable when its dependencies can fail?", "Mention timeouts, retries, and graceful degradation."),
    q("data-consistency", "How do you keep data consistent when a request touches several services?", "Explain transactions, idempotency, or eventual consistency."),
    q("production-incident", "Tell me about a production incident you helped solve. What was your role?", "Describe detection, mitigation, root cause, and prevention."),
    q("async-processing", "When would you use a message queue instead of a direct API call?", "Give a clear use case and one trade-off."),
    q("backend-security", "How do you protect a backend service and its data from common attacks?", "Mention authentication, input validation, and secrets handling."),
  ],
  "Full-Stack Engineer": [
    q("feature-end-to-end", "How would you build a new feature from the database all the way to the user interface?", "Follow the flow in order and mention key decisions."),
    q("api-contract", "How do you design the contract between the front end and the back end?", "Talk about shared types, errors, and handling changes."),
    q("full-stack-debugging", "Tell me about a bug that crossed the front end and the back end. How did you find it?", "Explain how you traced the problem across layers."),
    q("full-stack-performance", "A page is slow. How do you decide whether the problem is in the front end or the back end?", "Describe what you measure and in which order."),
    q("full-stack-trade-off", "Tell me about a time you had to choose speed over quality in a project. What did you do?", "Explain the pressure, your choice, and how you managed the risk."),
    q("authentication", "How would you add secure login to a web application?", "Cover sessions or tokens, storage, and common risks."),
    q("data-modeling", "How do you decide how to model data when requirements keep changing?", "Mention flexibility, migrations, and keeping things simple."),
    q("deployment", "How do you ship changes safely to production in a full-stack application?", "Describe tests, deployment steps, and how you roll back."),
  ],
  "Mobile Engineer": [
    q("app-architecture", "How do you structure a mobile app so that it stays easy to change as it grows?", "Name an architecture pattern and why it helps."),
    q("offline-support", "How would you design an app that works well with a slow or offline connection?", "Talk about local storage, syncing, and conflicts."),
    q("mobile-performance", "Users say your app is slow or drains the battery. How do you investigate?", "Mention profiling tools and the most common causes."),
    q("release-process", "How do you release a mobile app safely when you cannot update it instantly?", "Cover staged rollouts, feature flags, and store review."),
    q("mobile-debugging", "Tell me about a crash that was hard to reproduce. How did you solve it?", "Explain logs, crash reports, and how you found the cause."),
    q("platform-differences", "How do you handle differences between iOS and Android in your work?", "Compare native and cross-platform choices with trade-offs."),
    q("mobile-testing", "How do you test a mobile app across many devices and operating system versions?", "Mention automated tests, real devices, and priorities."),
    q("mobile-security", "How do you protect user data and tokens stored on a mobile device?", "Mention secure storage, network security, and permissions."),
  ],
  "DevOps Engineer": [
    q("ci-cd", "How would you design a CI/CD pipeline for a team that deploys many times a day?", "Cover build, tests, deployment, and rollback."),
    q("infrastructure-as-code", "Why is infrastructure as code useful, and how do you manage it in a team?", "Mention review, state, and avoiding manual changes."),
    q("deployment-strategy", "How do you deploy a change with almost no downtime?", "Compare rolling, blue-green, and canary deployments."),
    q("monitoring", "How do you decide what to monitor and when to alert someone?", "Focus on useful alerts and avoiding noise."),
    q("production-incident", "Tell me about a production incident you handled. What did you do first?", "Describe detection, mitigation, root cause, and follow-up."),
    q("containers", "How do you run and manage containerized applications in production?", "Talk about orchestration, resources, and health checks."),
    q("secrets-management", "How do you manage secrets and access in your pipelines and infrastructure?", "Mention least privilege, rotation, and audit."),
    q("developer-experience", "How do you help developers move faster without losing safety?", "Give an example of a tool or process you improved."),
  ],
  "Site Reliability Engineer": [
    q("slo", "How do you define and use service level objectives for a service?", "Explain SLIs, SLOs, and how error budgets guide decisions."),
    q("incident-response", "How do you handle a major production incident, from the first alert to the final review?", "Cover roles, communication, mitigation, and recovery."),
    q("postmortem", "How do you run a blameless postmortem, and how do you make sure the fixes actually happen?", "Focus on learning, action items, and follow-up."),
    q("observability", "How do you use metrics, logs, and traces to find the cause of a problem?", "Explain what each signal is good for with an example."),
    q("capacity-planning", "How do you plan capacity for a service before a big traffic event?", "Mention load testing, limits, and safety margins."),
    q("toil-automation", "Tell me about a repetitive manual task you automated. What changed after that?", "Quantify the time saved or the errors avoided."),
    q("alert-quality", "Your team gets too many noisy alerts. What do you do?", "Talk about alert quality, ownership, and prioritization."),
    q("resilience", "How would you make a critical service survive the failure of a whole data center?", "Discuss redundancy, failover, and testing the plan."),
  ],
  "Cloud Engineer": [
    q("cloud-architecture", "How would you design a highly available web application in the cloud?", "Mention regions, load balancing, and managed services."),
    q("cloud-migration", "How would you migrate an existing on-premises application to the cloud?", "Describe assessment, strategy, risks, and cutover."),
    q("cost-optimization", "Our cloud bill grew quickly. How would you reduce costs without hurting reliability?", "Start with visibility, then discuss the biggest savings."),
    q("cloud-security", "How do you secure a cloud environment, from accounts to network to data?", "Mention least privilege, network limits, and encryption."),
    q("iac", "How do you manage cloud resources with infrastructure as code in a team?", "Cover modules, review, and handling drift."),
    q("networking", "How would you set up networking for services in different environments?", "Describe isolation, access paths, and traffic control."),
    q("disaster-recovery", "How do you plan for disaster recovery, including your recovery time and data loss targets?", "Define both terms and give a practical plan."),
    q("cloud-incident", "Tell me about a cloud outage or misconfiguration you handled. What happened?", "Explain the cause, your fix, and the prevention."),
  ],
  "Data Engineer": [
    q("pipeline-design", "How would you design a data pipeline that moves data from many sources into a warehouse?", "Cover ingestion, transformation, storage, and monitoring."),
    q("batch-vs-streaming", "When would you use streaming instead of batch processing?", "Link the choice to latency needs, cost, and complexity."),
    q("data-quality", "How do you make sure the data in your pipelines is correct and trusted?", "Mention tests, validation, and alerts on bad data."),
    q("data-modeling", "How do you model data in a warehouse so analysts can use it easily?", "Explain a modeling approach and who benefits."),
    q("pipeline-failure", "Tell me about a pipeline that failed or produced bad data. How did you fix it?", "Describe detection, the cause, the fix, and prevention."),
    q("scaling-data", "A data job that ran in minutes now takes hours. How do you investigate?", "Start with where the time goes, then optimize."),
    q("orchestration", "How do you schedule and orchestrate many dependent data jobs?", "Mention dependencies, retries, and backfills."),
    q("data-governance", "How do you handle sensitive data, privacy, and access in your pipelines?", "Mention access control, masking, and compliance."),
  ],
  "Data Scientist": [
    q("problem-framing", "A business team asks you to predict customer churn. How do you start?", "Clarify the goal, the data, and how success is measured."),
    q("model-evaluation", "How do you evaluate a model and decide it is good enough for production?", "Choose metrics that match the business problem."),
    q("experimentation", "How would you design and analyze an A/B test for a new feature?", "Cover hypothesis, sample size, metrics, and pitfalls."),
    q("messy-data", "How do you deal with missing, biased, or messy data?", "Give a practical approach and the risks you watch for."),
    q("overfitting", "What is overfitting, and how do you prevent it?", "Explain it simply, then give two practical methods."),
    q("explaining-results", "How do you explain a complex model or result to a non-technical stakeholder?", "Use plain words, an example, and the business impact."),
    q("model-failure", "Tell me about a model or analysis that did not work. What did you learn?", "Explain what went wrong and what you changed."),
    q("model-monitoring", "How do you know when a model in production starts to perform badly?", "Mention drift, monitoring, and retraining."),
  ],
  "Data Analyst": [
    q("analysis-approach", "A stakeholder asks why sales dropped last month. How do you investigate?", "Clarify the question, then explain your steps in order."),
    q("sql-experience", "Tell me about a complex SQL query you wrote. What problem did it solve?", "Describe the goal, the logic, and how you checked it."),
    q("data-quality", "How do you check that your data is reliable before you share results?", "Mention validation steps and how you handle surprises."),
    q("metrics-definition", "How do you define a good metric for a product or business team?", "Link the metric to a decision and avoid vanity numbers."),
    q("dashboard-design", "How do you design a dashboard that people actually use?", "Think about the audience, key questions, and simplicity."),
    q("storytelling", "How do you present findings so that a manager can take action?", "Start with the insight, then the evidence and the next step."),
    q("conflicting-data", "Two reports show different numbers for the same metric. What do you do?", "Explain how you find the cause and align the teams."),
    q("prioritizing-requests", "You get many data requests at once. How do you decide what to do first?", "Mention impact, urgency, and clear communication."),
  ],
  "Machine Learning Engineer": [
    q("ml-system-design", "How would you design a system that serves a machine learning model to millions of users?", "Cover data, training, serving, latency, and monitoring."),
    q("production-ml", "What is the hardest part of taking a model from a notebook to production?", "Give a real example and how you solved it."),
    q("model-monitoring", "How do you monitor a model in production and detect drift?", "Mention data and quality signals, alerts, and retraining."),
    q("feature-pipeline", "How do you make sure features are the same in training and in production?", "Explain training-serving skew and how to avoid it."),
    q("model-evaluation", "How do you decide whether a new model is better than the current one?", "Mention offline metrics, online tests, and risks."),
    q("model-optimization", "A model is too slow or too expensive to serve. What do you do?", "Discuss profiling, optimization, and trade-offs with quality."),
    q("ml-failure", "Tell me about a model that behaved badly in production. What happened?", "Describe the symptom, the cause, and the fix."),
    q("ml-pipelines", "How do you make machine learning experiments reproducible and automated?", "Mention versioning, pipelines, and tracking."),
  ],
  "AI Engineer": [
    q("llm-app-design", "How would you design an application that uses a large language model to answer user questions?", "Describe the flow, data sources, and safety checks."),
    q("rag", "What is retrieval-augmented generation, and when would you use it?", "Explain it simply and compare it with fine-tuning."),
    q("llm-evaluation", "How do you evaluate the quality of an AI feature when answers are open-ended?", "Mention test sets, human review, and automatic checks."),
    q("hallucinations", "How do you reduce wrong or made-up answers from a language model?", "Give practical methods and their limits."),
    q("prompt-iteration", "Can you describe a time you improved an AI feature by changing the prompt or the design?", "Explain the problem, your change, and the measured result."),
    q("latency-cost", "An AI feature is too slow and too expensive. How do you improve it?", "Discuss model choice, caching, and prompt size."),
    q("ai-safety", "How do you handle safety and privacy risks in an AI product?", "Mention data handling, guardrails, and monitoring."),
    q("ai-trade-off", "How do you decide between using an API model, an open-source model, or a custom model?", "Compare quality, cost, control, and effort."),
  ],
  "AI Deployment Engineer": [
    q("customer-deployment", "How would you deploy an AI solution inside a customer's environment?", "Cover requirements, setup, testing, and handoff."),
    q("customer-requirements", "A customer's request is vague. How do you turn it into a clear technical plan?", "Show how you ask questions and confirm expectations."),
    q("integration", "How do you integrate an AI system with a customer's existing tools and data?", "Mention access, data quality, and fallback plans."),
    q("deployment-problem", "Tell me about a deployment that went wrong. How did you recover?", "Explain the problem, the fix, and how you kept the customer informed."),
    q("explaining-ai-limits", "How do you explain the limits and risks of AI to a customer who expects magic?", "Use plain words and set realistic expectations."),
    q("production-monitoring", "How do you monitor an AI system after launch and decide when to intervene?", "Mention quality, cost, and incident signals."),
    q("security-compliance", "A customer has strict security and compliance rules. How do you deploy safely?", "Talk about data handling, access, and documentation."),
    q("product-feedback", "How do you bring customer problems back to the product and engineering teams?", "Give an example of feedback that changed the product."),
  ],
  "QA Automation Engineer": [
    q("automation-strategy", "How would you build an automation strategy for a product that has almost no tests?", "Prioritize by risk and start small."),
    q("test-pyramid", "What do you automate at the unit, API, and UI levels, and why?", "Explain the balance and the cost of each level."),
    q("flaky-tests", "Your automated tests are flaky. How do you find the causes and fix them?", "Mention isolation, waits, data, and environment issues."),
    q("framework-design", "How do you design a test framework that other people can maintain?", "Talk about structure, readability, and reuse."),
    q("bug-found", "Tell me about an important bug your testing found. What was the impact?", "Explain how you found it and what it prevented."),
    q("ci-integration", "How do you run automated tests in a CI pipeline without slowing the team down?", "Mention parallel runs, test selection, and fast feedback."),
    q("quality-with-developers", "How do you work with developers to improve quality earlier in the process?", "Give examples like reviews, shared ownership, and clear criteria."),
    q("release-risk", "A release is tomorrow, and you still have many untested areas. What do you do?", "Explain how you assess risk and communicate."),
  ],
  "Security Engineer": [
    q("threat-modeling", "How would you do a threat model for a new web application?", "Describe assets, attackers, and the main risks."),
    q("vulnerability-management", "You find a critical vulnerability in production. What are your first steps?", "Cover assessment, containment, communication, and the fix."),
    q("secure-development", "How do you help developers write secure code without slowing them down?", "Mention tools, training, and being a partner."),
    q("authentication-design", "How would you design secure authentication and authorization for an application?", "Cover strong login, sessions, and least privilege."),
    q("incident-response", "Tell me about a security incident you worked on. What was your role?", "Explain detection, response, and lessons learned."),
    q("cloud-security", "How do you secure cloud infrastructure and the secrets it uses?", "Mention identity, networks, and secret management."),
    q("risk-prioritization", "You have many security findings and little time. How do you decide what to fix first?", "Focus on impact, exploitability, and context."),
    q("security-vs-speed", "A product team wants to ship fast, but you see a security risk. How do you handle it?", "Show how you explain risk and find a practical option."),
  ],
  "Engineering Manager": [
    q("team-performance", "How do you handle an engineer on your team who is struggling with performance?", "Describe clear expectations, support, and follow-up."),
    q("delivery", "A project is falling behind schedule. What do you do?", "Explain how you find the cause and communicate options."),
    q("hiring", "How do you evaluate candidates when you hire engineers?", "Mention the skills and signals you look for."),
    q("prioritization", "How do you balance new features, technical debt, and the team's workload?", "Show how you decide and explain trade-offs to others."),
    q("growing-people", "How do you help engineers grow in their careers?", "Give a concrete example of coaching someone."),
    q("stakeholder-conflict", "Product asks for more than the team can deliver. How do you respond?", "Show how you negotiate scope and protect the team."),
    q("team-conflict", "Two engineers on your team strongly disagree about a technical decision. What do you do?", "Explain how you listen, decide, and keep trust."),
    q("team-culture", "How do you build a team culture where people share problems early?", "Mention trust, habits, and what you do as a leader."),
  ],
};

const genericTechnical = [
  q("system-design", "How would you design a simple system that many people use at the same time?", "Clarify requirements, outline the main parts, then discuss trade-offs."),
  q("problem-solving", "What is a difficult problem you solved when the path forward was unclear?", "Focus on how you investigated the problem and what you learned."),
  q("trade-off", "Tell me about a technical trade-off you had to make. What did you choose, and why?", "Name the options, the constraint, and why your decision was reasonable."),
  q("quality", "How do you make sure your work is good before you share it with others?", "Give two or three concrete habits and one example."),
  q("learning", "Can you describe a time you had to learn a new tool or skill quickly?", "Explain how you learned and how you applied it."),
  q("prioritization", "You have too many tasks and not enough time. How do you decide what to do first?", "Mention impact, deadlines, and communication."),
  q("collaboration", "How do you work with people from other teams, such as product or design?", "Give an example that shows clear communication."),
  q("production-problem", "Tell me about a problem that appeared after a release. What did you do?", "Describe how you reacted, fixed it, and prevented it."),
];

export const genericQuestionBank = buildBank(genericTechnical);

const questionBanks = Object.fromEntries(
  Object.entries(technicalByRole).map(([role, technical]) => [role, buildBank(technical)]),
);

const normalizedRoleBanks = new Map(Object.entries(questionBanks).map(([role, bank]) => [normalizeRole(role), bank]));

// Common variants candidates type instead of the listed role name.
const roleAliases = {
  "fullstack engineer": "Full-Stack Engineer",
  "full stack engineer": "Full-Stack Engineer",
  "full-stack developer": "Full-Stack Engineer",
  "full stack developer": "Full-Stack Engineer",
  "software developer": "Software Engineer",
  "front-end engineer": "Frontend Engineer",
  "front end engineer": "Frontend Engineer",
  "frontend developer": "Frontend Engineer",
  "back-end engineer": "Backend Engineer",
  "back end engineer": "Backend Engineer",
  "backend developer": "Backend Engineer",
  "sre": "Site Reliability Engineer",
  "ml engineer": "Machine Learning Engineer",
  "qa engineer": "QA Automation Engineer",
  "sdet": "QA Automation Engineer",
  "devops": "DevOps Engineer",
  "data science": "Data Scientist",
};

function normalizeRole(role) {
  return String(role ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Returns the fixed question bank (templates with a {role} placeholder) for the typed role. */
export function getQuestionBankForRole(role) {
  const normalized = normalizeRole(role);
  const alias = roleAliases[normalized];
  return normalizedRoleBanks.get(alias ? normalizeRole(alias) : normalized) ?? genericQuestionBank;
}

export const questionBankRoles = Object.keys(questionBanks);
