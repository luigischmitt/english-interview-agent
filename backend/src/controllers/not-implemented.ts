import type { RequestHandler } from "express";

export function notImplemented(resource: string): RequestHandler {
  return (_request, response) => {
    response.status(501).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: `The ${resource} service is not connected yet.`,
      },
    });
  };
}
