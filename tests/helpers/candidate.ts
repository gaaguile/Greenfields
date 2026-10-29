import type { CandidateProject } from "../../src/pipeline/candidate.ts";

// A valid candidate new project, for tests.
export const candidate = (o: Partial<CandidateProject> = {}): CandidateProject => ({
  name: "Cerro Azul", aliases: [], company: "Andes Exploration Corp.", minerals: ["Copper", "Gold"], region: "Atacama",
  stageText: "Early-stage exploration", greenfield: true, inChile: true, companyWebsite: null,
  quote: "Cerro Azul project is an early-stage exploration project", confidence: 0.85, ...o,
});
