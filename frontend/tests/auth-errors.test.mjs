import assert from "node:assert/strict";
import test from "node:test";
import { authErrorCode, authErrorMessage, suggestEmailCorrection } from "../src/lib/auth/auth-errors.mjs";

test("maps Supabase auth errors by code and by legacy message", () => {
  assert.equal(authErrorCode({ code: "email_not_confirmed", message: "Email not confirmed" }), "email_not_confirmed");
  assert.equal(authErrorCode({ status: 400, message: "Invalid login credentials" }), "invalid_credentials");
  assert.equal(authErrorCode({ status: 400, message: "Email not confirmed" }), "email_not_confirmed");
  assert.equal(authErrorCode({ status: 422, message: "User already registered" }), "user_already_exists");
  assert.equal(authErrorCode({ status: 429, message: "email rate limit exceeded" }), "over_email_send_rate_limit");
  assert.equal(authErrorCode({ status: 429, message: "Too many requests" }), "over_request_rate_limit");
  assert.match(authErrorMessage({ code: "invalid_credentials" }), /E-mail ou senha incorretos/);
  assert.match(authErrorMessage({ code: "email_not_confirmed" }), /não foi confirmado/);
  assert.match(authErrorMessage(new Error("boom")), /Não foi possível concluir/);
  assert.match(authErrorMessage(new Error("Missing NEXT_PUBLIC_SUPABASE_URL")), /não está configurado/);
});

test("suggests a fix for mistyped e-mail domains only", () => {
  assert.equal(suggestEmailCorrection("sofiaomarques26@gamil.com"), "sofiaomarques26@gmail.com");
  assert.equal(suggestEmailCorrection("ana@gmial.com"), "ana@gmail.com");
  assert.equal(suggestEmailCorrection("ana@gmail.con"), "ana@gmail.com");
  assert.equal(suggestEmailCorrection("ana@hotmial.com"), "ana@hotmail.com");
  assert.equal(suggestEmailCorrection("ana@outlok.com"), "ana@outlook.com");
  assert.equal(suggestEmailCorrection("ana@gmail.com"), null);
  assert.equal(suggestEmailCorrection("ana@empresa.com.br"), null);
  assert.equal(suggestEmailCorrection("ana@ufpb.br"), null);
  assert.equal(suggestEmailCorrection("not-an-email"), null);
});
