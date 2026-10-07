export function createSessionValidator(loadMembership) {
  return async function validateSession(authContext) {
    if (!authContext || authContext.kind !== "session" || !authContext.userId) return authContext;

    const membership = await loadMembership({
      userId: authContext.userId,
      tenantId: authContext.tenantId,
    });
    if (!membership?.active || !membership.role) return null;

    return { ...authContext, role: membership.role };
  };
}

