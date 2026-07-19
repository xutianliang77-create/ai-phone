import type {
  EnterpriseMeetingScreenShareDto,
  EnterpriseMeetingScreenShareResponse,
} from "@translation/contracts";
import type { EnterpriseMeetingApi } from "../api/enterprise-meeting-api.js";
import type { EnterpriseContentRequestContext } from "../api/enterprise-api.js";
import {
  enterpriseScreenShareDelay,
  enterpriseScreenShareErrorCode,
} from "./enterprise-meeting-screen-share-publisher.js";

type Command = "pause" | "stop" | "force_stop";
type Operation = "idle" | "pausing" | "paused" | "stopping" | "failed";
type Update = {
  operation?: Operation;
  share?: EnterpriseMeetingScreenShareDto;
  revocation?: "not_required" | "completed" | "pending";
  errorCode?: string;
};

export class EnterpriseMeetingScreenShareRevocationController {
  constructor(
    private readonly api: EnterpriseMeetingApi,
    private readonly context: EnterpriseContentRequestContext,
    private readonly meetingId: string,
    private readonly isDisposed: () => boolean,
    private readonly emit: (value: Update) => void,
  ) {}

  async forceStop(input: {
    share: EnterpriseMeetingScreenShareDto | null;
    participantId: string;
    busy: boolean;
    onStart(): void;
    onFinish(): void;
  }) {
    const share = input.share;
    if (!share || share.participantId === input.participantId || input.busy ||
      this.isDisposed() || !["active", "paused"].includes(share.status)) return;
    input.onStart();
    const key = crypto.randomUUID();
    try {
      const response = await this.request("force_stop", share, key);
      this.emit(responseUpdate("force_stop", response));
      if (response.revocation === "pending") this.retry("force_stop", share, key);
    } catch (error) {
      this.emit({ operation: "failed", errorCode: enterpriseScreenShareErrorCode(error) });
    } finally {
      input.onFinish();
    }
  }

  retry(command: Command, original: EnterpriseMeetingScreenShareDto, key: string) {
    void this.retryBounded(command, original, key);
  }

  private async retryBounded(
    command: Command,
    original: EnterpriseMeetingScreenShareDto,
    key: string,
  ) {
    for (let attempt = 0; attempt < 3 && !this.isDisposed(); attempt += 1) {
      await enterpriseScreenShareDelay(1_500);
      try {
        const response = await this.request(command, original, key);
        this.emit(responseUpdate(command, response));
        if (response.revocation !== "pending") return;
      } catch {
        // The durable server outbox remains authoritative after bounded retries.
      }
    }
    this.emit({ errorCode: "screen_share_revocation_pending" });
  }

  private request(
    command: Command,
    share: EnterpriseMeetingScreenShareDto,
    key: string,
  ) {
    if (command === "force_stop") {
      return this.api.forceStopMeetingScreenShare(
        this.context, this.meetingId, share.id,
        { expectedVersion: share.version }, key,
      );
    }
    return this.api.commandMeetingScreenShare(
      this.context, this.meetingId, share.id, command,
      { expectedVersion: share.version }, key,
    );
  }
}

function responseUpdate(
  command: Command,
  response: EnterpriseMeetingScreenShareResponse,
): Update {
  const completed = command === "pause" ? "paused" : "idle";
  const pending = command === "pause" ? "pausing" : "stopping";
  return {
    share: response.share,
    revocation: response.revocation,
    operation: response.revocation === "pending" ? pending : completed,
  };
}
