import { handleRequest } from "./app.js";

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
