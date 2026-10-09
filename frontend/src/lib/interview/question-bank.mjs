// Fixed interview question bank, one list of 15 questions per role plus a generic list.
// Order: introduction, role-specific and behavioral questions (most representative first), closing.
// Every prompt is a single spoken-friendly question (one "?", no line breaks, up to 220 characters).

// `coverage: "broad-project"` marks a broad "describe a project/experience" question: a project already described in
// an earlier answer makes it redundant, so the interviewer may skip it.
const q = (id, prompt, cue, coverage) => (coverage ? { id, prompt, cue, coverage } : { id, prompt, cue });

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
  "broad-project",
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
function buildBank(technical, behavioral = { ownership, impact }) {
  if (technical.length !== 8) throw new Error("Each role needs exactly 8 technical questions.");
  const [t1, t2, t3, t4, t5, t6, t7, t8] = technical;
  return [introduction, t1, t2, behavioral.ownership, t3, conflict, t4, failure, t5, t6, feedback, t7, behavioral.impact, t8, closing];
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

// Junior technical questions: fundamentals and own experience. No large-scale design, leadership, or org-level strategy.
const juniorTechnicalByRole = {
  "Software Engineer": [
    q("project-built", "Can you walk me through a project you built and the part you were responsible for?", "Describe the goal, your part, and the tools you used.", "broad-project"),
    q("debugging-bug", "Tell me about a bug you fixed. How did you find the cause?", "Explain your steps from the symptom to the fix."),
    q("testing-code", "How do you test your code before you ask someone to review it?", "Mention the kinds of tests you write and one example."),
    q("git-workflow", "How do you use Git and pull requests when you work with other developers?", "Describe branches, commits, and how you respond to review comments."),
    q("explain-concept", "Can you explain a programming concept you use often, like an API or a database index, in simple words?", "Pick one concept and explain it with a short example."),
    q("learning-tool", "Tell me about a time you had to learn a new tool or library to finish a task. How did you do it?", "Explain how you learned and how you applied it."),
    q("reading-code", "How do you start when you have to read and understand code written by someone else?", "Describe where you look first and how you ask questions."),
    q("simple-trade-off", "Tell me about a simple technical decision you made, like choosing between two libraries. Why did you choose one?", "Name the options and the reason behind your choice."),
  ],
  "Frontend Engineer": [
    q("ui-project", "Can you describe a web interface you built and the part you were responsible for?", "Describe the goal, your part, and the technologies you used.", "broad-project"),
    q("html-css-basics", "How do you build a layout that works well on both a phone and a desktop screen?", "Mention flexible layouts, breakpoints, and testing on devices."),
    q("browser-debugging", "Tell me about a bug you fixed in the browser. How did you find it?", "Mention the browser tools you used and the fix."),
    q("javascript-concept", "Can you explain a JavaScript or React concept you use often, like state or props, in simple words?", "Pick one concept and explain it with a short example."),
    q("basic-accessibility", "What basic things do you do to make a page easier to use for everyone?", "Give simple practices like labels, contrast, and keyboard use."),
    q("component-reuse", "Tell me about a component you created and reused. What did you learn?", "Explain what the component did and why it was reusable."),
    q("working-with-design", "How do you handle a design that you do not fully understand?", "Show how you ask questions and confirm details early."),
    q("learning-framework", "Tell me about a time you had to learn a new library or framework quickly. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Backend Engineer": [
    q("api-built", "Can you describe an API you built and the endpoints you were responsible for?", "Describe the purpose, the endpoints, and the technologies you used."),
    q("sql-basics", "How would you explain what a database index is and why it helps?", "Use a simple example and mention one trade-off."),
    q("backend-bug", "Tell me about a bug you fixed in a backend service. How did you find the cause?", "Mention logs, tests, and the final fix."),
    q("http-basics", "What happens when a client sends a request to your API and gets a response?", "Walk through the request in simple, ordered steps."),
    q("api-testing", "How do you test an endpoint you just wrote?", "Mention unit tests, manual calls, and edge cases."),
    q("error-handling", "How do you handle errors in your API so other developers understand what went wrong?", "Talk about status codes and clear messages."),
    q("git-and-review", "How do you use pull requests and code review when you work with a team?", "Describe how you share changes and respond to feedback."),
    q("learning-backend", "Tell me about a time you had to learn something new for a backend task. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Full-Stack Engineer": [
    q("full-stack-project", "Can you describe a web application you built, from the screen to the database?", "Follow the flow in order and mention your part."),
    q("full-stack-bug", "Tell me about a bug you fixed that involved both the front end and the back end. How did you find it?", "Explain how you traced the problem step by step."),
    q("simple-api-use", "How does your front end talk to your back end in a project you built?", "Mention requests, responses, and handling errors."),
    q("database-basics", "How did you decide how to store the data in a project you built?", "Describe the tables or collections and why you chose them."),
    q("testing-code", "How do you test a feature you built before you share it?", "Mention the kinds of tests you write and one example."),
    q("git-workflow", "How do you use Git and pull requests when you work with other developers?", "Describe branches, commits, and how you respond to review comments."),
    q("learning-tool", "Tell me about a time you had to learn a new tool or framework to finish a task. How did you do it?", "Explain how you learned and how you applied it."),
    q("asking-help", "When do you ask a teammate for help, and how do you ask?", "Show that you try first and then ask a clear question."),
  ],
  "Mobile Engineer": [
    q("mobile-project", "Can you describe a mobile app you built and the part you were responsible for?", "Describe the goal, your part, and the tools you used.", "broad-project"),
    q("mobile-bug", "Tell me about a bug or crash you fixed in a mobile app. How did you find the cause?", "Mention logs, the debugger, and the final fix."),
    q("screen-layout", "How do you build a screen that looks good on different phone sizes?", "Mention flexible layouts and testing on devices."),
    q("app-lifecycle", "Can you explain in simple words what happens when a user opens, leaves, and returns to your app?", "Describe the main states and what you save."),
    q("mobile-testing", "How do you test your app before you share it with others?", "Mention emulators, real devices, and simple automated tests."),
    q("mobile-api", "How does your app get data from a server, and what do you show while it loads?", "Mention requests, loading states, and errors."),
    q("git-workflow", "How do you use Git and pull requests when you work with other developers?", "Describe branches, commits, and how you respond to review comments."),
    q("learning-tool", "Tell me about a time you had to learn a new tool or platform feature for a task. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "DevOps Engineer": [
    q("devops-project", "Can you describe a pipeline or automation you set up and what it did?", "Describe the goal, the steps, and the tools you used."),
    q("ci-basics", "What is a CI pipeline, and why is it useful for a team?", "Explain it in simple words with a short example."),
    q("docker-basics", "How would you explain what a container is to a developer who has never used one?", "Use a simple comparison and one practical benefit."),
    q("linux-troubleshooting", "A service is not responding on a server. What are the first things you check?", "Walk through simple checks like logs, status, and resources."),
    q("scripting", "Tell me about a script you wrote to automate a task. What did it save?", "Explain the task and the time or errors you saved."),
    q("git-workflow", "How do you use Git and pull requests when you work with other developers?", "Describe branches, commits, and how you respond to review comments."),
    q("devops-bug", "Tell me about a build or deployment problem you fixed. How did you find the cause?", "Mention logs, the steps you tried, and the fix."),
    q("learning-tool", "Tell me about a time you had to learn a new tool, like Terraform or Kubernetes. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Site Reliability Engineer": [
    q("sre-basics", "In simple words, what does it mean for a service to be reliable?", "Mention availability, speed, and what users notice."),
    q("monitoring-basics", "What is the difference between logs and metrics, and when do you use each one?", "Give a simple example of each."),
    q("troubleshooting-steps", "A service is slow, and you get an alert. What are your first steps?", "Walk through simple checks in a clear order."),
    q("script-automation", "Tell me about a script or small tool you wrote to automate a manual task. What changed?", "Explain the task and the time or errors you saved."),
    q("incident-learning", "Tell me about a problem in a system you worked on, even a small one. What did you learn?", "Describe what happened, your role, and the lesson."),
    q("linux-basics", "Which Linux commands do you use to understand what is happening on a server?", "Name a few commands and what each one tells you."),
    q("runbook-reading", "How would you use a runbook or documentation when you are on call for the first time?", "Show that you follow steps and ask for help early."),
    q("learning-tool", "Tell me about a time you had to learn a new monitoring or infrastructure tool. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Cloud Engineer": [
    q("cloud-project", "Can you describe something you built or deployed in the cloud and your part in it?", "Describe the goal, the services, and your contribution.", "broad-project"),
    q("cloud-basics", "How would you explain the difference between a virtual machine and a managed service?", "Use a simple example and one trade-off."),
    q("iam-basics", "What does least privilege mean, and how did you apply it in a cloud account?", "Explain it simply with a short example."),
    q("cloud-troubleshooting", "A cloud application stopped working after a change. What do you check first?", "Walk through simple checks like logs, settings, and permissions."),
    q("iac-basics", "What is a simple cloud resource you created with infrastructure as code, and how did you do it?", "Name the tool and describe what you created."),
    q("cost-awareness", "How do you avoid spending more than you need when you create cloud resources?", "Mention small sizes, cleaning up, and budgets."),
    q("git-workflow", "How do you use Git and pull requests when you work with other engineers?", "Describe branches, commits, and how you respond to review comments."),
    q("learning-tool", "Tell me about a time you had to learn a new cloud service quickly. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Data Engineer": [
    q("pipeline-built", "Can you describe a data pipeline or script you built and what it did?", "Describe the source, the steps, and the result.", "broad-project"),
    q("sql-explain", "Can you explain a SQL query you wrote that joined two tables?", "Describe the goal, the join, and how you checked the result."),
    q("data-cleaning", "How do you handle missing or duplicate values when you prepare data?", "Give a simple approach and a short example."),
    q("data-quality-checks", "How do you check that the data your job loaded is correct?", "Mention simple checks like counts and null values."),
    q("pipeline-bug", "Tell me about a data job that failed. How did you find the cause?", "Mention logs, the data, and the fix."),
    q("etl-basics", "What is the difference between ETL and ELT, in simple words?", "Explain both with a short example."),
    q("git-workflow", "How do you use Git and pull requests when you work with other engineers?", "Describe branches, commits, and how you respond to review comments."),
    q("learning-tool", "Tell me about a time you had to learn a new data tool. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Data Scientist": [
    q("analysis-project", "Can you describe a data science project you worked on and your part in it?", "Describe the question, the data, your method, and the result.", "broad-project"),
    q("data-cleaning", "How do you clean and prepare data before you train a model?", "Give a simple approach and a short example."),
    q("overfitting-basics", "What is overfitting, and how did you check for it in a project?", "Explain it simply, then give one practical method."),
    q("metric-choice", "How did you choose a metric to evaluate a model in one of your projects?", "Link the metric to the problem you were solving."),
    q("simple-model", "Can you explain a simple model you used, like linear regression, in plain words?", "Use a short example and avoid heavy math."),
    q("explaining-results", "How do you explain your results to someone who is not technical?", "Use plain words, an example, and the main takeaway."),
    q("analysis-mistake", "Tell me about a mistake you found in an analysis. How did you fix it?", "Explain what went wrong and what you changed."),
    q("learning-tool", "Tell me about a time you had to learn a new library or technique. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Data Analyst": [
    q("analysis-project", "Can you describe an analysis you did and the question you wanted to answer?", "Describe the question, the data, and the result."),
    q("sql-explain", "Can you explain a simple SQL query you wrote, step by step?", "Describe the goal, the tables, and how you checked the result."),
    q("data-cleaning", "How do you clean a dataset that has missing values or duplicates?", "Give a simple approach and a short example."),
    q("spreadsheet-skills", "Which tools do you use for analysis, like Excel, SQL, or Python, and what do you use each for?", "Give a short example for each tool."),
    q("chart-choice", "How do you choose a chart to show your results clearly?", "Link the chart to the message you want to show."),
    q("explaining-findings", "How do you explain your findings to someone who is not technical?", "Start with the main point, then give one piece of evidence."),
    q("data-check", "How do you check that your numbers are correct before you share them?", "Mention simple checks and what you do when something looks wrong."),
    q("learning-tool", "Tell me about a time you had to learn a new tool, like Power BI or Tableau. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Machine Learning Engineer": [
    q("ml-project", "Can you describe a machine learning project you built and your part in it?", "Describe the problem, the data, your model, and the result.", "broad-project"),
    q("train-test-split", "Why do we split data into training and test sets?", "Explain it simply and mention what could go wrong."),
    q("data-preparation", "How do you prepare data before you train a model?", "Give a simple approach and a short example."),
    q("model-metric", "How did you decide whether your model was good enough in a project?", "Link the metric to the problem you were solving."),
    q("ml-bug", "Tell me about a problem you had while training or running a model. How did you fix it?", "Describe the symptom, your steps, and the fix."),
    q("simple-deploy", "How did you share a model you built with others, for example as a simple API or a notebook?", "Describe the steps and one lesson you learned."),
    q("git-workflow", "How do you use Git and pull requests when you work with other engineers?", "Describe branches, commits, and how you respond to review comments."),
    q("learning-tool", "Tell me about a time you had to learn a new ML library or technique. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "AI Engineer": [
    q("ai-project", "Can you describe an AI feature or project you built and your part in it?", "Describe the goal, the model you used, and the result.", "broad-project"),
    q("prompt-basics", "How do you write a prompt that gives a clear and useful answer from a language model?", "Mention clear instructions, examples, and testing."),
    q("llm-wrong-answers", "A language model gives a wrong answer in your app. What do you do?", "Walk through simple checks and improvements."),
    q("rag-basics", "Can you explain in simple words what retrieval-augmented generation is?", "Use a short example of searching documents first."),
    q("api-usage", "How do you call a model API from your code and handle errors?", "Mention keys, requests, retries, and limits."),
    q("ai-testing", "How do you test that an AI feature works well for a few real examples?", "Describe a small set of test cases and what you check."),
    q("git-workflow", "How do you use Git and pull requests when you work with other developers?", "Describe branches, commits, and how you respond to review comments."),
    q("learning-tool", "Tell me about a time you had to learn a new AI tool or library quickly. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "AI Deployment Engineer": [
    q("deploy-project", "Can you describe something you set up or deployed for a user or a customer and your part in it?", "Describe the goal, the steps, and the result.", "broad-project"),
    q("customer-question", "A customer asks for something you do not fully understand. What do you do?", "Show how you ask clear questions and confirm."),
    q("setup-troubleshooting", "A setup does not work on a customer's machine. How do you find the problem?", "Walk through simple checks, from logs to settings."),
    q("explaining-simply", "How do you explain a technical concept to someone who is not technical?", "Use plain words and a short example."),
    q("api-integration", "How did you connect one tool to another with an API in a project you worked on?", "Describe the steps, the data, and any issue you solved."),
    q("documentation", "How do you write instructions so that someone else can follow your setup?", "Mention clear steps, examples, and testing the guide."),
    q("learning-tool", "Tell me about a time you had to learn a new tool quickly to help a user. How did you do it?", "Explain how you learned and how you applied it."),
    q("asking-help", "When do you ask a teammate for help, and how do you ask?", "Show that you try first and then ask a clear question."),
  ],
  "QA Automation Engineer": [
    q("test-case", "How do you write a good test case for a new feature?", "Mention the steps, the expected result, and edge cases."),
    q("bug-report", "How do you report a bug so that a developer can understand and fix it quickly?", "Mention steps to reproduce, expected result, actual result, and evidence."),
    q("automation-first", "Tell me about a test you automated. What tools did you use?", "Describe the test, the tool, and the result."),
    q("manual-vs-automated", "How do you decide whether to test something manually or automate it?", "Mention repeated checks, stability, and effort."),
    q("bug-found", "Tell me about a bug you found. How did you find it?", "Explain what you tried and what the bug affected."),
    q("test-types", "What is the difference between a unit test, an API test, and a UI test?", "Give a simple example of each."),
    q("working-with-devs", "How do you talk with a developer who disagrees that something is a bug?", "Show how you stay calm and use evidence."),
    q("learning-tool", "Tell me about a time you had to learn a new testing tool, like Playwright or Cypress. How did you do it?", "Explain how you learned and how you applied it."),
  ],
  "Security Engineer": [
    q("security-basics", "In simple words, what are some common web security risks, like SQL injection or cross-site scripting?", "Pick one or two risks and explain each with an example."),
    q("password-storage", "How should an application store user passwords, and why?", "Mention hashing, salting, and never storing plain text."),
    q("security-project", "Tell me about a security task you did, like fixing a vulnerability or scanning a project. What happened?", "Describe the issue, your steps, and the result."),
    q("least-privilege", "What does least privilege mean, and where have you applied it?", "Explain it simply with a short example."),
    q("vulnerability-report", "You find a security issue in a project. How do you report it clearly?", "Describe what, where, impact, and how to reproduce it."),
    q("dependency-risks", "How do you check that the libraries used in a project are safe?", "Mention updates, scanners, and reading alerts."),
    q("security-learning", "What is something recent you learned about security, and how did you learn it?", "Give a specific resource or practice you tried."),
    q("asking-help", "When do you ask a teammate for help, and how do you ask?", "Show that you try first and then ask a clear question."),
  ],
  "Engineering Manager": [
    q("team-project", "Can you describe a team project you worked on and your part in it?", "Describe the goal, your part, and how the team worked together.", "broad-project"),
    q("planning-tasks", "How do you plan and organize your own tasks during a week?", "Mention priorities, estimates, and updating others."),
    q("status-updates", "How do you give a clear status update to your team when a task is late?", "Show how you share the problem early and propose a next step."),
    q("helping-teammate", "Tell me about a time you helped a teammate finish something. What did you do?", "Describe the situation, your help, and the result."),
    q("receiving-feedback", "How do you react when a teammate or lead gives you tough feedback?", "Show openness and one concrete change you made."),
    q("asking-help", "When do you ask for help, and how do you ask?", "Show that you try first and then ask a clear question."),
    q("learning-process", "Tell me about a time you had to learn a new tool or process for your team. How did you do it?", "Explain how you learned and how you applied it."),
    q("team-communication", "How do you make sure you and your teammates understand a task in the same way?", "Mention asking questions and confirming in writing."),
  ],
};

const genericJuniorTechnical = [
  q("project-built", "Can you walk me through a project you built and the part you were responsible for?", "Describe the goal, your part, and the tools you used.", "broad-project"),
  q("debugging-bug", "Tell me about a problem you fixed. How did you find the cause?", "Explain your steps from the symptom to the fix."),
  q("simple-trade-off", "Tell me about a simple decision you made, like choosing between two tools. Why did you choose one?", "Name the options and the reason behind your choice."),
  q("quality-check", "How do you check your work before you share it with others?", "Give two or three concrete habits and one example."),
  q("learning-tool", "Tell me about a time you had to learn a new tool or skill to finish a task. How did you do it?", "Explain how you learned and how you applied it."),
  q("organizing-tasks", "You have several tasks and not enough time. How do you decide what to do first?", "Mention deadlines, importance, and telling others."),
  q("asking-help", "When do you ask a teammate for help, and how do you ask?", "Show that you try first and then ask a clear question."),
  q("reading-others-work", "How do you start when you have to understand work that someone else did?", "Describe where you look first and how you ask questions."),
];

// Behavioral variants for juniors: project participation instead of ownership, and impact on a small scale.
const juniorOwnership = q(
  "ownership",
  "Can you describe a project you worked on from start to finish, including your part and the result?",
  "Set the context, explain your contribution, and finish with the outcome.",
  "broad-project",
);
const juniorImpact = q(
  "impact",
  "How do you know when the work you delivered was useful to your team or to users?",
  "Use a specific result or signal rather than only describing activity.",
);

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

const juniorBehavioral = { ownership: juniorOwnership, impact: juniorImpact };
const juniorQuestionBanks = Object.fromEntries(
  Object.entries(juniorTechnicalByRole).map(([role, technical]) => [role, buildBank(technical, juniorBehavioral)]),
);
export const genericJuniorQuestionBank = buildBank(genericJuniorTechnical, juniorBehavioral);


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

// Keyword fallback for titles outside the exact/alias lookup, most specific first. Patterns run on the lowercased title.
const roleKeywordRules = [
  [/\b(?:qa|sdet|quality|tester|testes?|testing|test (?:analyst|engineer|automation))\b/, "QA Automation Engineer"],
  [/\b(?:security|seguran[cç]a)\b/, "Security Engineer"],
  [/\b(?:machine learning|ml|mlops)\b/, "Machine Learning Engineer"],
  [/\b(?:ai|ia)\b.*\b(?:engineer|engenheir[oa]|developer)\b/, "AI Engineer"],
  [/\b(?:data scien\w*|cientista de dados)\b/, "Data Scientist"],
  [/\b(?:data engineer\w*|engenheir[oa] de dados|analytics engineer)\b/, "Data Engineer"],
  [/\b(?:data analyst|analista de dados|bi analyst|business intelligence|analista de bi)\b/, "Data Analyst"],
  [/\b(?:sre|site reliability|confiabilidade)\b/, "Site Reliability Engineer"],
  [/\b(?:devops|devsecops|platform engineer|infrastructure engineer|engenheir[oa] de plataforma|engenheir[oa] de infraestrutura)\b/, "DevOps Engineer"],
  [/\b(?:cloud|nuvem)\b/, "Cloud Engineer"],
  [/\b(?:ios|android|mobile|react native|flutter)\b/, "Mobile Engineer"],
  [/\b(?:full[\s-]?stack)\b/, "Full-Stack Engineer"],
  [/\b(?:front[\s-]?end|frontend)\b/, "Frontend Engineer"],
  [/\b(?:back[\s-]?end|backend)\b/, "Backend Engineer"],
  [/\b(?:engineering manager|gerente de engenharia)\b/, "Engineering Manager"],
  [/\b(?:software|desenvolvedor[a]?|developer|programmer|programador[a]?)\b/, "Software Engineer"],
];

/** Returns the fixed question bank (templates with a {role} placeholder) for the typed role and seniority. */
export function getQuestionBankForRole(role, seniority) {
  const junior = String(seniority ?? "").trim().toLowerCase() === "junior";
  const banks = junior ? juniorQuestionBanks : questionBanks;
  const fallback = junior ? genericJuniorQuestionBank : genericQuestionBank;
  const normalized = normalizeRole(role);
  const alias = roleAliases[normalized];
  const key = alias ?? [...Object.keys(questionBanks)].find((name) => normalizeRole(name) === normalized);
  if (key || !normalized) return key ? banks[key] : fallback;
  const keyword = roleKeywordRules.find(([pattern]) => pattern.test(normalized));
  return keyword ? banks[keyword[1]] : fallback;
}

export const questionBankRoles = Object.keys(questionBanks);
