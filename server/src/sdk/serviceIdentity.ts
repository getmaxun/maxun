/** Stable operator-defined identity for this Maxun service instance. */
export const getServiceInstanceId = (): string => (
  process.env.MAXUN_SERVICE_INSTANCE_ID?.trim()
  || process.env.HOSTNAME?.trim()
  || 'maxun-local'
);
