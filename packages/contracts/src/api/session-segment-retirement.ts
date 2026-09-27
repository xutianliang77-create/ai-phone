/** Receipt for the original internal segment endpoint's public retirement. */
export interface SessionSegmentRetirementAck {
  sessionId: string;
  segmentId: string;
  revision: number;
  retired: boolean;
}
