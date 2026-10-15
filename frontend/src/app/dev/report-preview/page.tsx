import { notFound } from "next/navigation";
import { ReportPreview } from "./report-preview";

/** Development-only fixture for visual review of the report; 404 in production. */
export default function ReportPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ReportPreview />;
}
