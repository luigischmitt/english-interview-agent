"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, ArrowLeft } from "lucide-react";
import type { InterviewConfig } from "@/lib/interview/types";
import { defaultInterviewConfig, PageIntro } from "../home-client";

export function InterviewSetup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (config: InterviewConfig) => void;
}) {
  const [config, setConfig] = useState<InterviewConfig>(defaultInterviewConfig);
  const [showErrors, setShowErrors] = useState(false);

  const updateConfig = (field: keyof InterviewConfig, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }));
    if (showErrors && field === "role" && value.trim()) {
      setShowErrors(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config.role.trim()) {
      setShowErrors(true);
      return;
    }
    onStart({ ...config, role: config.role.trim() });
  };

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14">
      <button
        type="button"
        className="btn btn-ghost -ml-3 mb-7 gap-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to overview
      </button>

      <PageIntro
        title="Set the room up for you."
        description="Choose a few details so the practice feels close to the interview you are preparing for."
      />

      <form onSubmit={handleSubmit} className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]" noValidate>
        <section className="card card-border bg-card" aria-labelledby="interview-details-title" data-aos="fade-up" data-aos-duration="450">
          <div className="card-body gap-7 p-5 sm:p-8">
            <div>
              <h2 id="interview-details-title" className="card-title text-xl tracking-[-0.02em]">
                Interview details
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                You can change these choices whenever you start a new session.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <label className="fieldset gap-2 sm:col-span-2">
                <span className="fieldset-legend text-sm font-medium">Target role <span className="text-error" aria-hidden="true">*</span></span>
                <input
                  className={`input input-bordered h-11 w-full bg-base-100 ${showErrors ? "input-error" : ""}`}
                  value={config.role}
                  onChange={(event) => updateConfig("role", event.target.value)}
                  placeholder="e.g. Software Engineer"
                  aria-invalid={showErrors && !config.role.trim()}
                  aria-describedby={showErrors ? "role-error" : undefined}
                  required
                />
                {showErrors && !config.role.trim() && (
                  <span id="role-error" className="label text-error">Add the role you want to practice for.</span>
                )}
              </label>

              <label className="fieldset gap-2">
                <span className="fieldset-legend text-sm font-medium">Seniority</span>
                <select
                  className="select select-bordered h-11 w-full bg-base-100"
                  value={config.seniority}
                  onChange={(event) => updateConfig("seniority", event.target.value)}
                >
                  <option value="junior">Junior</option>
                  <option value="mid-level">Mid-level</option>
                  <option value="senior">Senior</option>
                  <option value="staff">Staff / Lead</option>
                </select>
              </label>

              <label className="fieldset gap-2">
                <span className="fieldset-legend text-sm font-medium">Practice focus</span>
                <select
                  className="select select-bordered h-11 w-full bg-base-100"
                  value={config.focus}
                  onChange={(event) => updateConfig("focus", event.target.value)}
                >
                  <option value="technical-depth">Technical depth</option>
                  <option value="communication">Communication and clarity</option>
                  <option value="behavioral">Behavioral answers</option>
                  <option value="mixed">Balanced practice</option>
                </select>
              </label>

              <fieldset className="fieldset gap-2">
                <legend className="fieldset-legend text-sm font-medium">Session length</legend>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Session length">
                  {["15", "25", "40"].map((minutes) => (
                    <label key={minutes} className={`btn btn-sm h-11 border ${config.duration === minutes ? "btn-primary" : "btn-ghost border-base-300"} focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2`}>
                      <input
                        type="radio"
                        name="duration"
                        value={minutes}
                        className="sr-only"
                        checked={config.duration === minutes}
                        onChange={(event) => updateConfig("duration", event.target.value)}
                      />
                      {minutes} min
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="fieldset gap-2">
                <legend className="fieldset-legend text-sm font-medium">Questions</legend>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Number of questions">
                  {["3", "5", "8"].map((count) => (
                    <label key={count} className={`btn btn-sm h-11 border ${config.questionCount === count ? "btn-primary" : "btn-ghost border-base-300"} focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2`}>
                      <input
                        type="radio"
                        name="questionCount"
                        value={count}
                        className="sr-only"
                        checked={config.questionCount === count}
                        onChange={(event) => updateConfig("questionCount", event.target.value)}
                      />
                      {count}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
              <button type="button" className="btn btn-ghost order-2 sm:order-1" onClick={onBack}>Cancel</button>
              <button type="submit" className="btn btn-primary order-1 gap-2 sm:order-2">Start interview <ArrowUpRight className="size-4" aria-hidden="true" /></button>
            </div>
          </div>
        </section>

        <aside className="border-y border-border py-6 lg:py-8" aria-labelledby="session-preview-title" data-aos="fade-up" data-aos-delay="80" data-aos-duration="450">
          <h2 id="session-preview-title" className="text-lg font-semibold tracking-[-0.02em]">Your session</h2>
          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="max-w-[14rem] truncate text-right font-medium">{config.role || "Not selected"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Level</dt>
              <dd className="font-medium capitalize">{config.seniority.replace("-", " ")}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Focus</dt>
              <dd className="max-w-[14rem] text-right font-medium">{config.focus.replaceAll("-", " ")}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">Format</dt>
              <dd className="font-medium">{config.questionCount} questions · {config.duration} min</dd>
            </div>
          </dl>
          <p className="mt-8 text-sm leading-6 text-muted-foreground">
            The interviewer will keep the conversation in English and use your choices to frame the session.
          </p>
        </aside>
      </form>
    </main>
  );

}
