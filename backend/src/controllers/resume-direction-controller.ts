import type { RequestHandler } from "express";
import multer from "multer";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { ThinkingServiceError } from "../thinking/errors.js";
import type { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { ResumeDirectionService } from "../thinking/types.js";

export const maximumResumeBytes = 5 * 1024 * 1024;
export const maximumResumePages = 20;
export const maximumResumeCharacters = 30_000;
const minimumResumeCharacters = 120;
const standardFontDataUrl = `${join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`;

type PdfExtraction = { text: string; pageCount: number };
export type ResumePdfExtractor = (buffer: Buffer) => Promise<PdfExtraction>;
type ResumeLease = { release: (outcome?: "success" | "failure") => void };

class ResumePdfLimitError extends Error {
  constructor(readonly reason: "too_many_pages" | "content_too_large", readonly pageCount: number, readonly extractedChars: number) {
    super(reason);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumResumeBytes, files: 1, fields: 0 },
});

function error(response: Parameters<RequestHandler>[1], status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

function logRejected(outcome: string, pages = 0, extractedChars = 0): void {
  console.info(JSON.stringify({
    event: "interview_resume_analysis_timing",
    durationMs: 0,
    pages,
    extractedChars,
    questionCount: 0,
    outcome,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }));
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/gu, "")
    .replace(/[\t\f\v]+/gu, " ")
    .replace(/ +/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function hasEnoughResumeContent(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  return text.length >= minimumResumeCharacters && words.length >= 20 && new Set(words.map((word) => word.toLocaleLowerCase())).size >= 12;
}

/** Contact details are irrelevant to question generation and never leave the backend. */
export function redactResumeContactDetails(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[contact redacted]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, "[link redacted]")
    .replace(/(?<![\p{L}\p{N}])\+?(?=(?:\D*\d){9,})(?:\d[\d\s().-]{7,}\d)(?![\p{L}\p{N}])/gu, "[phone redacted]");
}

export const extractResumePdf: ResumePdfExtractor = async (buffer) => {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    // PDF.js 6 removed the vulnerable dynamic-eval path; keep the official patched build pinned.
    useWorkerFetch: false,
    standardFontDataUrl,
  });
  let document: Awaited<typeof loadingTask.promise> | undefined;
  try {
    document = await loadingTask.promise;
    if (document.numPages > maximumResumePages) throw new ResumePdfLimitError("too_many_pages", document.numPages, 0);

    const pages: string[] = [];
    let extractedChars = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("");
      pages.push(pageText);
      extractedChars += pageText.length;
      if (extractedChars > maximumResumeCharacters) {
        throw new ResumePdfLimitError("content_too_large", document.numPages, extractedChars);
      }
      page.cleanup();
    }
    return { text: normalizeExtractedText(pages.join("\n\n")), pageCount: document.numPages };
  } finally {
    await loadingTask.destroy();
  }
};

/** Only a completed analysis starts the per-user cooldown; any rejection or failure lets the user retry immediately. */
function releaseResumeLease(response: Parameters<RequestHandler>[1], outcome: "success" | "failure" = "failure"): void {
  const lease = response.locals.resumeDirectionLease as ResumeLease | undefined;
  if (!lease) return;
  delete response.locals.resumeDirectionLease;
  lease.release(outcome);
}

function acquireResumeLease(userLimit: JobDirectionUserLimit): RequestHandler {
  return (request, response, next) => {
    const userId = response.locals.authenticatedUser?.userId;
    if (typeof userId !== "string" || userId.length === 0) {
      error(response, 401, "UNAUTHENTICATED", "Sua sessão expirou. Entre novamente.");
      return;
    }
    const lease = userLimit.acquire(userId);
    if (!lease.allowed) {
      logRejected(`rate_limited_${lease.reason}`);
      response.setHeader("Retry-After", String(lease.retryAfterSeconds));
      error(response, 429, "RESUME_DIRECTION_RATE_LIMITED", "A análise de currículo está temporariamente limitada. Tente novamente em instantes.");
      return;
    }
    response.locals.resumeDirectionLease = lease;
    request.once("aborted", () => releaseResumeLease(response));
    next();
  };
}

function receiveResumeFile(request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]): void {
  upload.single("resume")(request, response, (uploadError) => {
    if (!uploadError) {
      next();
      return;
    }
    releaseResumeLease(response);
    if (uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE") {
      logRejected("file_too_large");
      error(response, 413, "RESUME_FILE_TOO_LARGE", "O currículo deve ter no máximo 5 MB.");
      return;
    }
    logRejected("invalid_pdf");
    error(response, 400, "INVALID_RESUME_REQUEST", "Envie um único arquivo PDF no campo resume.");
  });
}

export function createResumeDirectionHandlers(
  service: ResumeDirectionService | null,
  userLimit: JobDirectionUserLimit,
  extractPdf: ResumePdfExtractor = extractResumePdf,
): RequestHandler[] {
  const analyze: RequestHandler = async (request, response) => {
    try {
      if (!service) {
        error(response, 503, "RESUME_DIRECTION_NOT_CONFIGURED", "A análise de currículo não está configurada neste servidor.");
        return;
      }
      const file = request.file;
      if (!file || file.mimetype !== "application/pdf" || file.size === 0 || file.size > maximumResumeBytes || file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        logRejected("invalid_pdf");
        error(response, 400, "INVALID_RESUME_REQUEST", "Envie um arquivo PDF válido de até 5 MB.");
        return;
      }

      let extracted: PdfExtraction;
      try {
        extracted = await extractPdf(file.buffer);
      } catch (extractionError) {
        if (extractionError instanceof ResumePdfLimitError && extractionError.reason === "too_many_pages") {
          logRejected("too_many_pages", extractionError.pageCount, extractionError.extractedChars);
          error(response, 422, "RESUME_TOO_MANY_PAGES", "O currículo deve ter no máximo 20 páginas.");
          return;
        }
        if (extractionError instanceof ResumePdfLimitError && extractionError.reason === "content_too_large") {
          logRejected("content_too_large", extractionError.pageCount, extractionError.extractedChars);
          error(response, 422, "RESUME_CONTENT_TOO_LARGE", "O texto extraído do currículo é muito extenso.");
          return;
        }
        logRejected("invalid_pdf");
        error(response, 422, "RESUME_INVALID_PDF", "Não foi possível ler este PDF. Verifique se ele não está protegido por senha.");
        return;
      }
      if (!Number.isInteger(extracted.pageCount) || extracted.pageCount < 1) {
        logRejected("invalid_pdf");
        error(response, 422, "RESUME_INVALID_PDF", "Não foi possível identificar as páginas deste PDF.");
        return;
      }
      if (extracted.pageCount > maximumResumePages) {
        logRejected("too_many_pages", extracted.pageCount, extracted.text.length);
        error(response, 422, "RESUME_TOO_MANY_PAGES", "O currículo deve ter no máximo 20 páginas.");
        return;
      }
      const resumeText = normalizeExtractedText(extracted.text);
      if (resumeText.length > maximumResumeCharacters) {
        logRejected("content_too_large", extracted.pageCount, resumeText.length);
        error(response, 422, "RESUME_CONTENT_TOO_LARGE", "O texto extraído do currículo é muito extenso.");
        return;
      }
      if (!hasEnoughResumeContent(resumeText)) {
        logRejected("empty", extracted.pageCount, resumeText.length);
        error(response, 422, "RESUME_INSUFFICIENT_CONTENT", "O PDF não contém texto suficiente para montar a entrevista.");
        return;
      }

      response.status(200).json(await service.analyze({ resumeText: redactResumeContactDetails(resumeText), pageCount: extracted.pageCount }));
    } catch (caught) {
      if (caught instanceof ThinkingServiceError && caught.code.startsWith("RESUME_DIRECTION_")) {
        error(response, caught.status, caught.code, caught.message);
        return;
      }
      logRejected("unexpected_error", 0, 0);
      error(response, 502, "RESUME_DIRECTION_PROVIDER_UNAVAILABLE", "Não foi possível analisar o currículo agora.");
    } finally {
      releaseResumeLease(response, response.statusCode === 200 ? "success" : "failure");
    }
  };

  return [acquireResumeLease(userLimit), receiveResumeFile, analyze];
}
