import { createRuntime, createRequestHandler } from '../apps/brand-studio/server.mjs';

let handlerPromise;

export default async function handler(request, response) {
  handlerPromise ||= createRuntime().then(createRequestHandler);
  const handler = await handlerPromise;
  return handler(request, response);
}
