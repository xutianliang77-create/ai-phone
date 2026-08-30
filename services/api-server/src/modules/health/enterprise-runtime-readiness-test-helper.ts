import { fixedEnterpriseControlPlaneAvailability } from
  "../enterprise/enterprise-control-plane-availability.js";
import { fixedEnterpriseAdmissionAvailability } from
  "../enterprise/enterprise-admission-availability.js";

export function readyControlPlaneAvailability() {
  return fixedEnterpriseControlPlaneAvailability({
    status: "ready", region: "cn-north", activeInstances: 2,
    drainingInstances: 0, incompatibleInstances: 0, expectedReplicas: 2,
    dueProvisionJobs: 0, backlogAgeSeconds: 0, issues: [],
  });
}

export function readyAdmissionAvailability() {
  return fixedEnterpriseAdmissionAvailability({
    status: "ready", policyCount: 4, activeUnits: 0,
    queuedUnits: 0, issues: [],
  });
}
