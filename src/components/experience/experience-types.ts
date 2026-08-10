export type StudentConnectionState = "missing" | "connecting" | "connected";

export type ExperienceStage =
  | "tutorial"
  | "training"
  | "exam"
  | "mission-selection"
  | "mission"
  | "result";

export type StudentGuideKind = "start" | "connect" | "arming" | "tutorial";

export type FeedbackTone =
  | "info"
  | "success"
  | "warning"
  | "collision"
  | "emergency";

export interface ExperienceAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface ExperienceProgress {
  current: number;
  total: number;
  label?: string;
}

export interface MissionCardContent {
  id: string;
  number: number;
  title: string;
  situation: string;
  objective: string;
  durationLabel?: string;
  locked?: boolean;
  accent?: "medical" | "search" | "neutral";
}

export interface ExperienceFeedbackItem {
  id: string;
  tone: FeedbackTone;
  title: string;
  message?: string;
}

export interface ExperienceScoreItem {
  id: string;
  label: string;
  score: number;
  maximum: number;
  rating?: number;
}

