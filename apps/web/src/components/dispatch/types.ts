/** What the board shows while a card hovers over a drop target. */
export interface DropPreview {
  targetId: string;
  technicianId: string;
  start: string;
  end: string;
  label: string;
  conflict: boolean;
}
