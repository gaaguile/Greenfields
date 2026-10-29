import type { StageCategory } from "../domain/stage.ts";

export interface PublicFigure {
  field: string;
  label: string;
  value: string;
  unit: string | null;
  basis: "100%" | "attributable";
  attributableShare: number | null;
  figureDate: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  quote: string | null;
  updatedAt: string;
}

export interface PublicChange {
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string;
  changedAt: string;
}

export interface PublicProject {
  slug: string;
  name: string;
  owners: string;
  minerals: string[];
  mineralsText: string;
  region: string;
  province: string | null;
  locationDetail: string | null;
  stage: StageCategory;
  stageLabel: string;
  stageText: string;
  stalled: boolean;
  capex: string | null;
  mineLife: string | null;
  resourceReserve: string | null;
  additionalInfo: string | null;
  // When the site last changed this project (drives the "Updated" badge).
  lastUpdated: string;
  // The newest date the project's information is as of: the figure's own date when the source gives one,
  // otherwise when it was recorded.
  latestReport: string;
  sourceUrl: string | null;
  figures: PublicFigure[];
  recentChanges: PublicChange[];
}

export interface PublicData {
  generatedAt: string;
  projects: PublicProject[];
}
