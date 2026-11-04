import { startVisitLink } from "./visit-link.js";

startVisitLink({ window, chrome, now: () => Date.now() });
