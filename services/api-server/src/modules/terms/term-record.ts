import type { TermbaseTermDto } from "@translation/contracts";

export interface TermbaseTermRecord extends TermbaseTermDto {
  userId: string;
  termbaseId: string;
}
