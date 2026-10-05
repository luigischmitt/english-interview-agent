import type { InterviewReport } from "./report";
export const mainPointLimits: { english: number; technical: number; priorities: number };
export function toSecondPerson(text: string): string;
export function deriveMainPoints(analysis: InterviewReport): {
  english: InterviewReport["englishCommunication"]["patterns"];
  technical: Array<InterviewReport["technicalContent"]["gaps"][number] & { kind: "gap" | "strength" }>;
  priorities: InterviewReport["priorities"];
  summary: string;
};
