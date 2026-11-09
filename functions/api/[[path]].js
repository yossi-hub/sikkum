import { createGateway } from '../../server/gateway.mjs';

const handleRequest = createGateway();
export function onRequest({ request, env }) {
  return handleRequest(request, env);
}
