const rpc = L.rpc;

export type ExternalEndpoint = {
  ipv4?: string;
  derpPort?: number;
  stunPort?: number;
  method?: string;
  leaseUntil?: string;
};

export type ExternalValidation = {
  scope?: string;
  state?: string;
  derp?: boolean;
  stun?: boolean;
  checkedAt?: string;
  error?: string;
};

export type ExternalInstanceStatus = {
  name?: string;
  label?: string;
  state?: string;
  lastAttempt?: string;
  lastSuccess?: string;
  error?: string;
};

export type ExternalStatus = {
  enabled?: boolean;
  state?: string;
  localDerpPort?: number;
  localStunPort?: number;
  endpoint?: ExternalEndpoint;
  validation?: ExternalValidation;
  validationEnabled?: boolean;
  failureCount?: number;
  failureThreshold?: number;
  lastAttempt?: string;
  lastSuccess?: string;
  error?: string;
  instances?: ExternalInstanceStatus[];
};

export type ExternalActionResponse = {
  result?: string;
  error?: string;
};

export const callExternalStatus = rpc.declare<ExternalStatus>({
  object: "luci.tailscale-derp",
  method: "get_external_status",
});

export const externalActionCalls = {
  reconcile: rpc.declare<ExternalActionResponse>({
    object: "luci.tailscale-derp",
    method: "reconcile_external",
  }),
  check: rpc.declare<ExternalActionResponse>({
    object: "luci.tailscale-derp",
    method: "check_external",
  }),
  sync: rpc.declare<ExternalActionResponse>({
    object: "luci.tailscale-derp",
    method: "sync_derpmap",
  }),
};
