import { startBackground } from "./background.js";

startBackground({ chrome, fetch: (input, init) => fetch(input, init), console });
