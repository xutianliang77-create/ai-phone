import type {
  CreateEnterpriseMemberRequest,
  EnterpriseMemberDto,
  UpdateEnterpriseMemberRequest,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type EnterpriseRequester = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface EnterpriseMemberApi {
  listMembers(context: EnterpriseContentRequestContext): Promise<{
    members: EnterpriseMemberDto[];
  }>;
  createMember(
    context: EnterpriseContentRequestContext,
    input: Omit<CreateEnterpriseMemberRequest, "tenantId">,
  ): Promise<{ member: EnterpriseMemberDto }>;
  updateMember(
    context: EnterpriseContentRequestContext,
    memberId: string,
    input: Omit<UpdateEnterpriseMemberRequest, "tenantId">,
  ): Promise<{ member: EnterpriseMemberDto }>;
}

export function createEnterpriseMemberApi(
  request: EnterpriseRequester,
  headers: (context: EnterpriseContentRequestContext) => Record<string, string>,
): EnterpriseMemberApi {
  return {
    listMembers: (context) => request("/enterprise/v1/members", {
      headers: headers(context),
    }),
    createMember: (context, input) => request("/enterprise/v1/members", {
      method: "POST",
      headers: headers(context),
      body: JSON.stringify(input),
    }),
    updateMember: (context, memberId, input) => request(
      `/enterprise/v1/members/${encodeURIComponent(memberId)}`,
      {
        method: "PATCH",
        headers: headers(context),
        body: JSON.stringify(input),
      },
    ),
  };
}
